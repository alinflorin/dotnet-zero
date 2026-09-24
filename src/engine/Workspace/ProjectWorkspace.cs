using System.Collections.Immutable;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using Basic.Reference.Assemblies;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

namespace engine.Workspace;

/// <summary>
/// Owns the in-memory Roslyn <see cref="AdhocWorkspace"/> for the single active project.
/// Source of truth for compiler state during a session; durable persistence across reloads
/// is handled by the caller via <see cref="GetSnapshotAsync"/> / <see cref="HydrateProject"/>.
/// </summary>
public sealed class ProjectWorkspace
{
    private const string DefaultProgramContent = "Console.WriteLine(\"Hello, World!\");\n";

    private AdhocWorkspace? _workspace;
    private ProjectId? _roslynProjectId;
    private string _projectId = "";
    private string? _projectName;
    private readonly Dictionary<string, DocumentId> _docIdByFileId = new(StringComparer.Ordinal);
    private readonly Dictionary<DocumentId, string> _fileIdByDocId = new();
    private readonly HashSet<string> _emptyFolders = new(StringComparer.Ordinal);

    public ProjectDto CreateProject(string name)
    {
        ResetWorkspace();
        _projectId = Guid.NewGuid().ToString("n");
        _projectName = name;
        _roslynProjectId = ProjectId.CreateNewId(name);

        _workspace!.AddProject(BuildProjectInfo(_roslynProjectId, name));
        AddFileCore(Array.Empty<string>(), "Program.cs", DefaultProgramContent);

        return BuildProjectDto();
    }

    public ProjectDto HydrateProject(ProjectSnapshot snapshot)
    {
        ResetWorkspace();
        _projectId = snapshot.Id;
        _projectName = snapshot.Name;
        _roslynProjectId = ProjectId.CreateNewId(snapshot.Name);

        _workspace!.AddProject(BuildProjectInfo(_roslynProjectId, snapshot.Name));

        foreach (var file in snapshot.Files)
            AddFileCore(file.Folders, file.Name, file.Content, file.Id);

        foreach (var folder in snapshot.EmptyFolders)
            _emptyFolders.Add(folder);

        return BuildProjectDto();
    }

    public async Task<ProjectSnapshot> GetSnapshotAsync()
    {
        EnsureProject();
        var files = new List<ProjectFileSnapshot>();
        foreach (var document in CurrentProject().Documents)
        {
            var text = await document.GetTextAsync().ConfigureAwait(false);
            files.Add(new ProjectFileSnapshot(_fileIdByDocId[document.Id], document.Name, document.Folders.ToList(), text.ToString()));
        }

        return new ProjectSnapshot(_projectId, _projectName!, files, _emptyFolders.ToList());
    }

    public IReadOnlyList<ProjectFileNode> GetFileTree()
    {
        EnsureProject();
        return BuildTree();
    }

    public async Task<string> GetFileContentAsync(string fileId)
    {
        EnsureProject();
        var document = CurrentProject().GetDocument(ResolveFileId(fileId))!;
        var text = await document.GetTextAsync().ConfigureAwait(false);
        return text.ToString();
    }

    public void UpdateFileContent(string fileId, string content)
    {
        EnsureProject();
        var docId = ResolveFileId(fileId);
        var solution = _workspace!.CurrentSolution.WithDocumentText(docId, SourceText.From(content));
        _workspace.TryApplyChanges(solution);
    }

    public IReadOnlyList<ProjectFileNode> AddFile(string? parentPath, string name)
    {
        EnsureProject();
        var folders = SplitFolderPath(parentPath);
        EnsureUniqueName(folders, name);
        AddFileCore(folders, name, "");
        return BuildTree();
    }

    public IReadOnlyList<ProjectFileNode> AddFolder(string? parentPath, string name)
    {
        EnsureProject();
        var folders = SplitFolderPath(parentPath);
        EnsureUniqueName(folders, name);
        _emptyFolders.Add(JoinFolderPath(folders.Append(name).ToArray()));
        return BuildTree();
    }

    public IReadOnlyList<ProjectFileNode> RenameEntry(string id, string newName)
    {
        EnsureProject();
        if (_docIdByFileId.TryGetValue(id, out var docId))
        {
            var document = CurrentProject().GetDocument(docId)!;
            EnsureUniqueName(document.Folders.ToList(), newName, excludeFileId: id);
            var solution = _workspace!.CurrentSolution.WithDocumentName(docId, newName);
            _workspace.TryApplyChanges(solution);
        }
        else
        {
            RenameFolder(id, newName);
        }

        return BuildTree();
    }

    public IReadOnlyList<ProjectFileNode> DeleteEntry(string id)
    {
        EnsureProject();
        if (_docIdByFileId.TryGetValue(id, out var docId))
        {
            var solution = _workspace!.CurrentSolution.RemoveDocument(docId);
            _workspace.TryApplyChanges(solution);
            _docIdByFileId.Remove(id);
            _fileIdByDocId.Remove(docId);
        }
        else
        {
            DeleteFolder(id);
        }

        return BuildTree();
    }

    public async Task<RunResult> CompileAndRunAsync()
    {
        EnsureProject();
        var compilation = await CurrentProject().GetCompilationAsync().ConfigureAwait(false)
            ?? throw new InvalidOperationException("Compilation unavailable.");

        using var peStream = new MemoryStream();
        var emitResult = compilation.Emit(peStream);
        var diagnostics = emitResult.Diagnostics
            .Where(d => d.Severity != DiagnosticSeverity.Hidden)
            .Select(ToCompileDiagnostic)
            .ToList();

        if (!emitResult.Success)
            return new RunResult(false, diagnostics, "", null);

        var assembly = Assembly.Load(peStream.ToArray());
        var entryPoint = assembly.EntryPoint;
        if (entryPoint is null)
            return new RunResult(false, diagnostics, "", "No entry point (Main method) found.");

        var previousOut = Console.Out;
        var previousError = Console.Error;
        var writer = new StringWriter();
        Console.SetOut(writer);
        Console.SetError(writer);

        string? exceptionMessage = null;
        try
        {
            var parameters = entryPoint.GetParameters().Length == 0 ? null : new object?[] { Array.Empty<string>() };
            var result = entryPoint.Invoke(null, parameters);
            if (result is Task task)
                await task.ConfigureAwait(false);
        }
        catch (TargetInvocationException ex)
        {
            exceptionMessage = (ex.InnerException ?? ex).ToString();
        }
        catch (Exception ex)
        {
            exceptionMessage = ex.ToString();
        }
        finally
        {
            Console.SetOut(previousOut);
            Console.SetError(previousError);
        }

        return new RunResult(exceptionMessage is null, diagnostics, writer.ToString(), exceptionMessage);
    }

    private CompileDiagnostic ToCompileDiagnostic(Diagnostic diagnostic)
    {
        var lineSpan = diagnostic.Location.GetLineSpan();
        string? fileId = null;
        string? fileName = null;
        if (diagnostic.Location.SourceTree is { } tree)
        {
            var document = CurrentProject().GetDocument(tree);
            if (document is not null)
            {
                fileId = _fileIdByDocId.GetValueOrDefault(document.Id);
                fileName = document.Name;
            }
        }

        return new CompileDiagnostic(
            diagnostic.Severity.ToString().ToLowerInvariant(),
            diagnostic.GetMessage(),
            fileId,
            fileName,
            lineSpan.StartLinePosition.Line + 1,
            lineSpan.StartLinePosition.Character + 1);
    }

    [MemberNotNull(nameof(_workspace))]
    private void ResetWorkspace()
    {
        _workspace?.Dispose();
        _workspace = new AdhocWorkspace();
        _docIdByFileId.Clear();
        _fileIdByDocId.Clear();
        _emptyFolders.Clear();
        _roslynProjectId = null;
    }

    private static ProjectInfo BuildProjectInfo(ProjectId projectId, string name) => ProjectInfo.Create(
        projectId,
        VersionStamp.Create(),
        name,
        name,
        LanguageNames.CSharp,
        compilationOptions: new CSharpCompilationOptions(OutputKind.ConsoleApplication, nullableContextOptions: NullableContextOptions.Enable),
        parseOptions: new CSharpParseOptions(LanguageVersion.Latest),
        metadataReferences: Net90.References.All);

    private void AddFileCore(IReadOnlyList<string> folders, string name, string content, string? existingId = null)
    {
        var documentId = DocumentId.CreateNewId(_roslynProjectId!);
        var fileId = existingId ?? Guid.NewGuid().ToString("n");
        var documentInfo = DocumentInfo.Create(
            documentId,
            name,
            folders: folders,
            sourceCodeKind: SourceCodeKind.Regular,
            loader: TextLoader.From(TextAndVersion.Create(SourceText.From(content), VersionStamp.Create())));

        _workspace!.AddDocument(documentInfo);
        _docIdByFileId[fileId] = documentId;
        _fileIdByDocId[documentId] = fileId;
    }

    private void RenameFolder(string folderPath, string newName)
    {
        var oldFolders = SplitFolderPath(folderPath);
        if (oldFolders.Length == 0)
            throw new InvalidOperationException($"Folder not found: {folderPath}");

        var parentFolders = oldFolders[..^1];
        EnsureUniqueName(parentFolders, newName);
        var newFolders = parentFolders.Append(newName).ToArray();

        if (_emptyFolders.Remove(folderPath))
            _emptyFolders.Add(JoinFolderPath(newFolders));

        var nestedEmptyFolders = _emptyFolders.Where(f => StartsWithPath(SplitFolderPath(f), oldFolders)).ToList();
        foreach (var nested in nestedEmptyFolders)
        {
            _emptyFolders.Remove(nested);
            var updated = newFolders.Concat(SplitFolderPath(nested).Skip(oldFolders.Length)).ToArray();
            _emptyFolders.Add(JoinFolderPath(updated));
        }

        var affectedDocuments = CurrentProject().Documents.Where(d => StartsWithPath(d.Folders, oldFolders)).ToList();
        var solution = _workspace!.CurrentSolution;
        foreach (var document in affectedDocuments)
        {
            var updatedFolders = newFolders.Concat(document.Folders.Skip(oldFolders.Length)).ToArray();
            solution = solution.WithDocumentFolders(document.Id, updatedFolders);
        }

        _workspace.TryApplyChanges(solution);
    }

    private void DeleteFolder(string folderPath)
    {
        var folders = SplitFolderPath(folderPath);
        if (folders.Length == 0)
            throw new InvalidOperationException($"Folder not found: {folderPath}");

        var toRemove = CurrentProject().Documents
            .Where(d => StartsWithPath(d.Folders, folders))
            .Select(d => d.Id)
            .ToImmutableArray();

        if (toRemove.Length > 0)
        {
            var solution = _workspace!.CurrentSolution.RemoveDocuments(toRemove);
            _workspace.TryApplyChanges(solution);
            foreach (var docId in toRemove)
            {
                if (_fileIdByDocId.Remove(docId, out var fileId))
                    _docIdByFileId.Remove(fileId);
            }
        }

        _emptyFolders.RemoveWhere(f => StartsWithPath(SplitFolderPath(f), folders));
    }

    private void EnsureUniqueName(IReadOnlyList<string> folders, string name, string? excludeFileId = null)
    {
        var project = CurrentProject();

        var fileConflict = project.Documents.Any(d =>
            d.Folders.Count == folders.Count &&
            StartsWithPath(d.Folders, folders) &&
            d.Name.Equals(name, StringComparison.OrdinalIgnoreCase) &&
            (excludeFileId is null || _fileIdByDocId[d.Id] != excludeFileId));

        var folderConflict = _emptyFolders.Any(f =>
        {
            var segments = SplitFolderPath(f);
            return segments.Length == folders.Count + 1 && StartsWithPath(segments, folders) &&
                   segments[^1].Equals(name, StringComparison.OrdinalIgnoreCase);
        }) || project.Documents.Any(d =>
            d.Folders.Count > folders.Count &&
            StartsWithPath(d.Folders, folders) &&
            d.Folders[folders.Count].Equals(name, StringComparison.OrdinalIgnoreCase));

        if (fileConflict || folderConflict)
            throw new InvalidOperationException($"'{name}' already exists.");
    }

    private IReadOnlyList<ProjectFileNode> BuildTree()
    {
        var root = new TreeNode();

        TreeNode EnsureFolderNode(IReadOnlyList<string> folders)
        {
            var node = root;
            var pathSoFar = new List<string>(folders.Count);
            foreach (var segment in folders)
            {
                pathSoFar.Add(segment);
                if (!node.Children.TryGetValue(segment, out var child))
                {
                    child = new TreeNode { Id = JoinFolderPath(pathSoFar), Name = segment, Kind = "folder" };
                    node.Children[segment] = child;
                }

                node = child;
            }

            return node;
        }

        foreach (var folderPath in _emptyFolders)
            EnsureFolderNode(SplitFolderPath(folderPath));

        foreach (var document in CurrentProject().Documents)
        {
            var folder = EnsureFolderNode(document.Folders);
            folder.Children[document.Name] = new TreeNode { Id = _fileIdByDocId[document.Id], Name = document.Name, Kind = "file" };
        }

        return root.Children.Values.OrderBy(n => n.Kind == "file").ThenBy(n => n.Name, StringComparer.OrdinalIgnoreCase).Select(ToDto).ToList();

        static ProjectFileNode ToDto(TreeNode node) => new(
            node.Id,
            node.Name,
            node.Kind,
            node.Kind == "folder"
                ? node.Children.Values.OrderBy(n => n.Kind == "file").ThenBy(n => n.Name, StringComparer.OrdinalIgnoreCase).Select(ToDto).ToList()
                : null);
    }

    private sealed class TreeNode
    {
        public string Id = "";
        public string Name = "";
        public string Kind = "folder";
        public Dictionary<string, TreeNode> Children { get; } = new(StringComparer.Ordinal);
    }

    private ProjectDto BuildProjectDto() => new(_projectId, _projectName!, BuildTree());

    private Project CurrentProject() => _workspace!.CurrentSolution.GetProject(_roslynProjectId!)!;

    private DocumentId ResolveFileId(string fileId)
    {
        if (!_docIdByFileId.TryGetValue(fileId, out var docId))
            throw new InvalidOperationException($"File not found: {fileId}");
        return docId;
    }

    [MemberNotNull(nameof(_workspace), nameof(_roslynProjectId), nameof(_projectName))]
    private void EnsureProject()
    {
        if (_workspace is null || _roslynProjectId is null || _projectName is null)
            throw new InvalidOperationException("No project is open.");
    }

    private static string[] SplitFolderPath(string? path) =>
        string.IsNullOrEmpty(path) ? [] : path.Split('/', StringSplitOptions.RemoveEmptyEntries);

    private static string JoinFolderPath(IReadOnlyList<string> folders) => string.Join('/', folders);

    private static bool StartsWithPath(IReadOnlyList<string> path, IReadOnlyList<string> prefix)
    {
        if (path.Count < prefix.Count)
            return false;

        for (var i = 0; i < prefix.Count; i++)
        {
            if (!string.Equals(path[i], prefix[i], StringComparison.Ordinal))
                return false;
        }

        return true;
    }
}
