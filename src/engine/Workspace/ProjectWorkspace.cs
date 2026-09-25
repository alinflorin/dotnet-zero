using System.Collections.Immutable;
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using System.Runtime.Loader;
using System.Text;
using System.Threading;
using Basic.Reference.Assemblies;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Completion;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.QuickInfo;
using Microsoft.CodeAnalysis.Text;
using System.Xml.Linq;

namespace engine.Workspace;

/// <summary>
/// Owns the in-memory Roslyn <see cref="AdhocWorkspace"/> for the single active project.
/// Source of truth for compiler state during a session; durable persistence across reloads
/// is handled by the caller via <see cref="GetSnapshotAsync"/> / <see cref="HydrateProject"/>.
/// </summary>
public sealed class ProjectWorkspace
{
    private const string GlobalUsingsFileName = "GlobalUsings.g.cs";

    private AdhocWorkspace? _workspace;
    private ProjectType _projectType = ProjectType.ConsoleNet10;
    private ProjectId? _roslynProjectId;
    private string _projectId = "";
    private string? _projectName;
    private readonly Dictionary<string, DocumentId> _docIdByFileId = new(StringComparer.Ordinal);
    private readonly Dictionary<DocumentId, string> _fileIdByDocId = new();
    private readonly HashSet<string> _emptyFolders = new(StringComparer.Ordinal);
    private readonly HashSet<DocumentId> _hiddenDocumentIds = new();
    private byte[]? _lastCompiledAssembly;
    private readonly NuGetPackageManager _packageManager = new();
    private readonly List<MetadataReference> _projectReferenceMetadata = new();

    private static readonly ImmutableArray<MetadataReference> Net10References =
        Net100.References.All.Cast<MetadataReference>().ToImmutableArray();
    private static readonly ImmutableArray<MetadataReference> NetStandard20References =
        NetStandard20.References.All.Cast<MetadataReference>().ToImmutableArray();
    private static readonly ImmutableArray<MetadataReference> NetStandard21References =
        NetStandard21.References.All.Cast<MetadataReference>().ToImmutableArray();
    private static readonly ImmutableArray<MetadataReference> AspNetNet10References =
        AspNet100.References.All.Cast<MetadataReference>().ToImmutableArray();

    /// <summary>Each reference-assembly set below (from the Basic.Reference.Assemblies packages) is a
    /// complete, standalone closure for its target framework, not a delta — <see cref="AspNetNet10References"/>
    /// already includes the full BCL alongside the ASP.NET Core / Extensions assemblies.</summary>
    private static ImmutableArray<MetadataReference> GetBaseMetadataReferences(ProjectType type) => type switch
    {
        ProjectType.LibraryNetStandard20 => NetStandard20References,
        ProjectType.LibraryNetStandard21 => NetStandard21References,
        ProjectType.WebApiNet10 => AspNetNet10References,
        _ => Net10References,
    };

    public string Id => _projectId;
    public string Name => _projectName ?? "";

    // The .csproj is real XML the user can view/edit, but it isn't a Roslyn document — feeding
    // it into the AdhocWorkspace's C# project would make the compiler try to parse XML as C#.
    // It's tracked as a side channel instead, with NuGet installs as the source of truth for
    // <PackageReference> content and the reverse sync (edit csproj by hand) parsed back out.
    private string _csprojFileId = "";
    private string _csprojFileName = "";
    private string _csprojContent = "";

    // Language-service calls (completions/hover/diagnostics) run on background threads
    // (see GetCompletionsAsync etc.) and race with each other as the user types/moves the
    // caret. Keying by request kind + file lets a newer request cancel a stale one in flight
    // instead of both burning CPU on the single Roslyn workspace.
    private readonly object _requestLock = new();
    private readonly Dictionary<string, CancellationTokenSource> _pendingRequests = new(StringComparer.Ordinal);

    private CancellationToken BeginRequest(string key)
    {
        lock (_requestLock)
        {
            if (_pendingRequests.TryGetValue(key, out var existing))
                existing.Cancel();

            var cts = new CancellationTokenSource();
            _pendingRequests[key] = cts;
            return cts.Token;
        }
    }

    public ProjectDto CreateProject(string name, ProjectType projectType = ProjectType.ConsoleNet10)
    {
        ResetWorkspace();
        _projectId = Guid.NewGuid().ToString("n");
        _projectName = name;
        _projectType = projectType;
        _roslynProjectId = ProjectId.CreateNewId(name);

        _workspace!.AddProject(BuildProjectInfo(_roslynProjectId, name));
        AddHiddenGlobalUsings();
        var (fileName, fileContent) = GetDefaultFile(projectType);
        AddFileCore(Array.Empty<string>(), fileName, fileContent);
        InitializeCsproj(name, projectType);

        return BuildProjectDto();
    }

    public async Task<ProjectDto> HydrateProjectAsync(ProjectSnapshot snapshot)
    {
        ResetWorkspace();
        _projectId = snapshot.Id;
        _projectName = snapshot.Name;
        _roslynProjectId = ProjectId.CreateNewId(snapshot.Name);

        ProjectFileSnapshot? csprojFile = snapshot.Files.FirstOrDefault(
            f => f.Folders.Count == 0 && f.Name.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase));
        // Snapshots predating a project type carry no detectable framework/output-type hints, so they
        // fall back to the original single template (console, net10.0).
        _projectType = csprojFile is not null ? ParseProjectType(csprojFile.Content) : ProjectType.ConsoleNet10;

        _workspace!.AddProject(BuildProjectInfo(_roslynProjectId, snapshot.Name));
        AddHiddenGlobalUsings();

        foreach (var file in snapshot.Files)
        {
            if (csprojFile is not null && file.Id == csprojFile.Id) continue;
            AddFileCore(file.Folders, file.Name, file.Content, file.Id);
        }

        foreach (var folder in snapshot.EmptyFolders)
            _emptyFolders.Add(folder);

        if (csprojFile is not null)
        {
            _csprojFileId = csprojFile.Id;
            _csprojFileName = csprojFile.Name;
            _csprojContent = csprojFile.Content;
            await SyncPackagesFromCsprojAsync(_csprojContent).ConfigureAwait(false);
        }
        else
        {
            // Snapshot predates the .csproj feature — synthesize a blank one.
            InitializeCsproj(snapshot.Name, _projectType);
        }

        return BuildProjectDto();
    }

    /// <summary>Recovers the project type from a persisted/hand-edited .csproj — the reverse of
    /// <see cref="BuildCsprojContent"/> — so reloading a snapshot compiles with the same output kind and
    /// reference-assembly set it was created with instead of always falling back to console/net10.0.</summary>
    private static ProjectType ParseProjectType(string csprojContent)
    {
        try
        {
            var root = XDocument.Parse(csprojContent).Root;
            if (root is null) return ProjectType.ConsoleNet10;

            var sdk = (string?)root.Attribute("Sdk") ?? "";
            if (sdk.Equals("Microsoft.NET.Sdk.Web", StringComparison.OrdinalIgnoreCase))
                return ProjectType.WebApiNet10;

            var targetFramework = root.Elements("PropertyGroup").Elements("TargetFramework").FirstOrDefault()?.Value ?? "";
            if (targetFramework.Equals("netstandard2.0", StringComparison.OrdinalIgnoreCase))
                return ProjectType.LibraryNetStandard20;
            if (targetFramework.Equals("netstandard2.1", StringComparison.OrdinalIgnoreCase))
                return ProjectType.LibraryNetStandard21;

            var outputType = root.Elements("PropertyGroup").Elements("OutputType").FirstOrDefault()?.Value ?? "";
            return outputType.Equals("Library", StringComparison.OrdinalIgnoreCase)
                ? ProjectType.LibraryNet10
                : ProjectType.ConsoleNet10;
        }
        catch (System.Xml.XmlException)
        {
            return ProjectType.ConsoleNet10;
        }
    }

    public async Task<ProjectSnapshot> GetSnapshotAsync()
    {
        EnsureProject();
        var files = new List<ProjectFileSnapshot>();
        foreach (var document in CurrentProject().Documents)
        {
            if (_hiddenDocumentIds.Contains(document.Id)) continue;
            var text = await document.GetTextAsync().ConfigureAwait(false);
            files.Add(new ProjectFileSnapshot(_fileIdByDocId[document.Id], document.Name, document.Folders.ToList(), text.ToString()));
        }

        files.Add(new ProjectFileSnapshot(_csprojFileId, _csprojFileName, Array.Empty<string>(), _csprojContent));

        return new ProjectSnapshot(_projectId, _projectName!, files, _emptyFolders.ToList());
    }

    public Task<NuGetSearchResponseDto> SearchPackagesAsync(string query, int skip, int take) =>
        _packageManager.SearchAsync(query, skip, take);

    public async Task<ProjectDto> InstallPackageAsync(string id, string? version)
    {
        EnsureProject();
        await _packageManager.InstallAsync(id, version).ConfigureAwait(false);
        RegenerateCsprojPackageReferences();
        ApplyReferences();
        return BuildProjectDto();
    }

    public ProjectDto UninstallPackage(string id)
    {
        EnsureProject();
        _packageManager.Uninstall(id);
        RegenerateCsprojPackageReferences();
        ApplyReferences();
        return BuildProjectDto();
    }

    public IReadOnlyList<InstalledPackageDto> GetInstalledPackages()
    {
        EnsureProject();
        return _packageManager.Installed;
    }

    /// <summary>Base .NET reference assemblies plus every installed NuGet package's assemblies plus the
    /// compiled assemblies of any referenced sibling projects — used both for this workspace's own
    /// compilation and by <see cref="DebugWorkspace"/>'s separate debug-instrumented one.</summary>
    public IReadOnlyList<MetadataReference> GetMetadataReferences() =>
        GetBaseMetadataReferences(_projectType).Concat(_packageManager.References).Concat(_projectReferenceMetadata).ToImmutableArray();

    /// <summary>Supplies the compiled output of the projects this one references (see
    /// <see cref="SolutionWorkspace.SetProjectReferences"/>) as additional metadata references, so this
    /// project's compilation can see their public types.</summary>
    public void SetProjectReferenceAssemblies(IReadOnlyList<byte[]> assemblies)
    {
        EnsureProject();
        _projectReferenceMetadata.Clear();
        foreach (var bytes in assemblies)
            _projectReferenceMetadata.Add(MetadataReference.CreateFromImage(bytes));
        ApplyReferences();
    }

    /// <summary>Rewrites the &lt;ProjectReference&gt; items in the .csproj to reflect the current reference
    /// graph — generated from <see cref="SolutionWorkspace"/>'s authoritative graph, one-directional (unlike
    /// package references, hand-editing these back doesn't reparse into the graph).</summary>
    public void SetProjectReferenceNames(IReadOnlyList<string> referencedProjectNames)
    {
        EnsureProject();
        RegenerateCsprojProjectReferences(referencedProjectNames);
    }

    internal void SetLastCompiledAssembly(byte[]? bytes) => _lastCompiledAssembly = bytes;

    internal Task<(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics, byte[]? AssemblyBytes)> EmitForBuildAsync() => EmitAsync();

    public void Rename(string newName)
    {
        EnsureProject();
        _projectName = newName;
        _csprojFileName = $"{newName}.csproj";
        _lastCompiledAssembly = null;
    }

    private void ApplyReferences()
    {
        var solution = _workspace!.CurrentSolution.WithProjectMetadataReferences(_roslynProjectId!, GetMetadataReferences());
        _workspace.TryApplyChanges(solution);
        _lastCompiledAssembly = null;
    }

    public IReadOnlyList<ProjectFileNode> GetFileTree()
    {
        EnsureProject();
        return BuildTree();
    }

    public async Task<string> GetFileContentAsync(string fileId)
    {
        EnsureProject();
        if (fileId == _csprojFileId)
            return _csprojContent;

        var document = CurrentProject().GetDocument(ResolveFileId(fileId))!;
        var text = await document.GetTextAsync().ConfigureAwait(false);
        return text.ToString();
    }

    public async Task UpdateFileContent(string fileId, string content)
    {
        EnsureProject();
        if (fileId == _csprojFileId)
        {
            _csprojContent = content;
            await SyncPackagesFromCsprojAsync(content).ConfigureAwait(false);
            _lastCompiledAssembly = null;
            return;
        }

        var docId = ResolveFileId(fileId);
        var solution = _workspace!.CurrentSolution.WithDocumentText(docId, SourceText.From(content));
        _workspace.TryApplyChanges(solution);
        _lastCompiledAssembly = null;
    }

    public IReadOnlyList<ProjectFileNode> AddFile(string? parentPath, string name)
    {
        EnsureProject();
        var folders = SplitFolderPath(parentPath);
        EnsureUniqueName(folders, name);
        AddFileCore(folders, name, "");
        _lastCompiledAssembly = null;
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
        if (id == _csprojFileId)
            throw new InvalidOperationException("The project file cannot be renamed.");

        if (_docIdByFileId.TryGetValue(id, out var docId))
        {
            var document = CurrentProject().GetDocument(docId)!;
            EnsureUniqueName(document.Folders.ToList(), newName, excludeFileId: id);
            var solution = _workspace!.CurrentSolution.WithDocumentName(docId, newName);
            _workspace.TryApplyChanges(solution);
            _lastCompiledAssembly = null;
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
        if (id == _csprojFileId)
            throw new InvalidOperationException("The project file cannot be deleted.");

        if (_docIdByFileId.TryGetValue(id, out var docId))
        {
            var solution = _workspace!.CurrentSolution.RemoveDocument(docId);
            _workspace.TryApplyChanges(solution);
            _docIdByFileId.Remove(id);
            _fileIdByDocId.Remove(docId);
            _lastCompiledAssembly = null;
        }
        else
        {
            DeleteFolder(id);
        }

        return BuildTree();
    }

    public async Task<CompileResult> CompileAsync()
    {
        var (success, diagnostics, assemblyBytes) = await EmitAsync().ConfigureAwait(false);
        _lastCompiledAssembly = success ? assemblyBytes : null;
        return new CompileResult(success, diagnostics);
    }

    public void Clean()
    {
        _lastCompiledAssembly = null;
    }

    /// <summary>Runs this project, loading <paramref name="dependencyAssemblies"/> (the compiled bytes of
    /// every project this one references, transitively) into the same isolated load context first so the
    /// runtime can resolve types from them — <see cref="MetadataReference.CreateFromImage"/> only satisfies
    /// the compiler, not execution.</summary>
    public async Task<RunResult> RunAsync(IReadOnlyList<byte[]> dependencyAssemblies)
    {
        if (_lastCompiledAssembly is { } cached)
            return await ExecuteAsync(cached, dependencyAssemblies, []).ConfigureAwait(false);

        return await CompileAndRunAsync(dependencyAssemblies).ConfigureAwait(false);
    }

    public async Task<RunResult> CompileAndRunAsync(IReadOnlyList<byte[]> dependencyAssemblies)
    {
        var (success, diagnostics, assemblyBytes) = await EmitAsync().ConfigureAwait(false);
        _lastCompiledAssembly = success ? assemblyBytes : null;

        if (!success)
            return new RunResult(false, diagnostics, "", null);

        return await ExecuteAsync(assemblyBytes!, dependencyAssemblies, diagnostics).ConfigureAwait(false);
    }

    public Task<IReadOnlyList<CompletionItemDto>> GetCompletionsAsync(string fileId, string content, int position, string? triggerCharacter)
    {
        var cancellationToken = BeginRequest($"completions:{fileId}");
        var document = TransientDocument(fileId, content);

        // Offload the actual Roslyn work (semantic analysis) to a thread-pool thread so it
        // doesn't block the UI thread. Only effective when WasmEnableThreads is on; on a
        // single-threaded runtime this just runs inline via the thread pool's WASM fallback.
        return Task.Run<IReadOnlyList<CompletionItemDto>>(async () =>
        {
            try
            {
                var completionService = CompletionService.GetService(document);
                if (completionService is null) return [];

                var trigger = triggerCharacter is { Length: > 0 }
                    ? CompletionTrigger.CreateInsertionTrigger(triggerCharacter[0])
                    : CompletionTrigger.Invoke;

                var completions = await completionService.GetCompletionsAsync(document, position, trigger, cancellationToken: cancellationToken).ConfigureAwait(false);
                return completions.ItemsList
                    .Select(item => new CompletionItemDto(item.DisplayText, item.Tags.FirstOrDefault() ?? "Text", item.DisplayText, item.SortText))
                    .ToList();
            }
            catch (OperationCanceledException)
            {
                return [];
            }
        }, cancellationToken);
    }

    /// <summary>Lazily computes the extra text edits (e.g. an added <c>using</c> directive) for a
    /// completion item the user actually committed. Deferred out of <see cref="GetCompletionsAsync"/>
    /// because <see cref="CompletionService.GetChangeAsync"/> is comparatively expensive and only the
    /// one committed item needs it — the same "resolve" split LSP completion uses.</summary>
    public Task<CompletionResolveDto?> ResolveCompletionAsync(string fileId, string content, int position, string label, string sortText)
    {
        var cancellationToken = BeginRequest($"resolve:{fileId}");
        var document = TransientDocument(fileId, content);

        return Task.Run<CompletionResolveDto?>(async () =>
        {
            try
            {
                var completionService = CompletionService.GetService(document);
                if (completionService is null) return null;

                var completions = await completionService.GetCompletionsAsync(
                    document, position, CompletionTrigger.Invoke, cancellationToken: cancellationToken).ConfigureAwait(false);

                var item = completions.ItemsList.FirstOrDefault(i => i.DisplayText == label && i.SortText == sortText);
                if (item is null) return null;

                var change = await completionService.GetChangeAsync(document, item, cancellationToken: cancellationToken).ConfigureAwait(false);
                if (change.TextChanges.IsDefaultOrEmpty) return null;

                var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);

                // The change Roslyn computes for an import-completion item bundles the primary
                // edit (replacing the typed prefix at the cursor) together with the added `using`.
                // Monaco already applies the primary edit itself via insertText/range, so only the
                // remaining edits (the `using` insertion) are surfaced here as additionalTextEdits.
                var additional = change.TextChanges
                    .Where(tc => !(tc.Span.Start <= position && position <= tc.Span.End))
                    .Select(tc =>
                    {
                        var (startLine, startColumn, endLine, endColumn) = ToRange(text, tc.Span);
                        return new TextEditDto(startLine, startColumn, endLine, endColumn, tc.NewText ?? "");
                    })
                    .ToList();

                return additional.Count == 0 ? null : new CompletionResolveDto(additional);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
        }, cancellationToken);
    }

    public Task<HoverDto?> GetHoverAsync(string fileId, string content, int position)
    {
        var cancellationToken = BeginRequest($"hover:{fileId}");
        var document = TransientDocument(fileId, content);

        return Task.Run<HoverDto?>(async () =>
        {
            try
            {
                var quickInfoService = QuickInfoService.GetService(document);
                if (quickInfoService is null) return null;

                var quickInfo = await quickInfoService.GetQuickInfoAsync(document, position, cancellationToken).ConfigureAwait(false);
                if (quickInfo is null) return null;

                var markdown = string.Join(
                    "\n\n",
                    quickInfo.Sections
                        .Select(section => string.Concat(section.TaggedParts.Select(part => part.Text)))
                        .Where(text => !string.IsNullOrWhiteSpace(text)));

                if (string.IsNullOrWhiteSpace(markdown)) return null;

                var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);
                var (startLine, startColumn, endLine, endColumn) = ToRange(text, quickInfo.Span);
                return new HoverDto(markdown, startLine, startColumn, endLine, endColumn);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
        }, cancellationToken);
    }

    // Roslyn's own SignatureHelpService/SignatureHelpItem types are internal to its feature assembly in
    // this version, so overloads are resolved directly from the semantic model instead (the same technique
    // OmniSharp uses): find the enclosing argument list, ask for its member group, and rank by best match.
    public Task<SignatureHelpDto?> GetSignatureHelpAsync(string fileId, string content, int position, string? triggerCharacter, bool isRetrigger)
    {
        var cancellationToken = BeginRequest($"signature:{fileId}");
        var document = TransientDocument(fileId, content);

        return Task.Run<SignatureHelpDto?>(async () =>
        {
            try
            {
                var syntaxRoot = await document.GetSyntaxRootAsync(cancellationToken).ConfigureAwait(false);
                var semanticModel = await document.GetSemanticModelAsync(cancellationToken).ConfigureAwait(false);
                if (syntaxRoot is null || semanticModel is null) return null;

                var argumentList = FindEnclosingArgumentList(syntaxRoot, position);
                if (argumentList?.Parent is not ExpressionSyntax invocationTarget) return null;

                var memberGroupNode = invocationTarget is InvocationExpressionSyntax invocation ? invocation.Expression : invocationTarget;
                var candidates = semanticModel.GetMemberGroup(memberGroupNode, cancellationToken).OfType<IMethodSymbol>().ToList();
                if (candidates.Count == 0) return null;

                var activeParameter = 0;
                foreach (var comma in argumentList.Arguments.GetSeparators())
                {
                    if (comma.Span.Start < position) activeParameter++;
                    else break;
                }

                var signatures = candidates.Select(method => BuildSignature(method, semanticModel, position)).ToList();

                var symbolInfo = semanticModel.GetSymbolInfo(invocationTarget, cancellationToken);
                var resolved = symbolInfo.Symbol as IMethodSymbol ?? symbolInfo.CandidateSymbols.OfType<IMethodSymbol>().FirstOrDefault();

                var activeSignature = resolved is not null
                    ? candidates.FindIndex(m => SymbolEqualityComparer.Default.Equals(m, resolved))
                    : candidates.FindIndex(m => m.Parameters.Length > activeParameter || (m.Parameters.Length > 0 && m.Parameters[^1].IsParams));
                if (activeSignature < 0) activeSignature = 0;

                return new SignatureHelpDto(signatures, activeSignature, activeParameter);
            }
            catch (OperationCanceledException)
            {
                return null;
            }
        }, cancellationToken);
    }

    private static ArgumentListSyntax? FindEnclosingArgumentList(SyntaxNode root, int position)
    {
        var searchPosition = Math.Clamp(position, 0, root.FullSpan.End);
        var tokenPosition = searchPosition > 0 ? searchPosition - 1 : 0;
        var token = root.FindToken(tokenPosition);

        foreach (var node in token.Parent?.AncestorsAndSelf() ?? Enumerable.Empty<SyntaxNode>())
        {
            if (node is not ArgumentListSyntax argumentList) continue;

            var afterOpenParen = argumentList.OpenParenToken.Span.End <= searchPosition;
            var beforeCloseParen = argumentList.CloseParenToken.IsMissing || searchPosition <= argumentList.CloseParenToken.Span.Start;
            if (afterOpenParen && beforeCloseParen) return argumentList;
        }

        return null;
    }

    private static SignatureItemDto BuildSignature(IMethodSymbol method, SemanticModel semanticModel, int position)
    {
        var label = new StringBuilder();
        if (method.MethodKind == MethodKind.Constructor)
            label.Append(method.ContainingType.ToMinimalDisplayString(semanticModel, position));
        else
        {
            label.Append(method.ReturnType.ToMinimalDisplayString(semanticModel, position));
            label.Append(' ');
            label.Append(method.Name);
        }
        label.Append('(');

        var xml = method.GetDocumentationCommentXml();
        var parameters = new List<SignatureParameterDto>();
        for (var i = 0; i < method.Parameters.Length; i++)
        {
            if (i > 0) label.Append(", ");
            var parameter = method.Parameters[i];

            var start = label.Length;
            if (parameter.IsParams) label.Append("params ");
            label.Append(parameter.Type.ToMinimalDisplayString(semanticModel, position));
            label.Append(' ');
            label.Append(parameter.Name);
            if (parameter.HasExplicitDefaultValue)
                label.Append(" = ").Append(FormatDefaultValue(parameter));
            var end = label.Length;

            parameters.Add(new SignatureParameterDto(start, end, GetXmlDocParam(xml, parameter.Name)));
        }

        label.Append(')');
        return new SignatureItemDto(label.ToString(), GetXmlDocSummary(xml), parameters);
    }

    private static string? FormatDefaultValue(IParameterSymbol parameter)
    {
        return parameter.ExplicitDefaultValue switch
        {
            null => parameter.Type.IsReferenceType || parameter.Type.TypeKind == TypeKind.TypeParameter ? "null" : "default",
            string s => $"\"{s}\"",
            bool b => b ? "true" : "false",
            char c => $"'{c}'",
            var v => v.ToString(),
        };
    }

    private static string? GetXmlDocSummary(string? xml) => GetXmlDocElementText(xml, doc => doc.Root?.Element("summary"));

    private static string? GetXmlDocParam(string? xml, string parameterName) =>
        GetXmlDocElementText(xml, doc => doc.Root?.Elements("param").FirstOrDefault(e => (string?)e.Attribute("name") == parameterName));

    private static string? GetXmlDocElementText(string? xml, Func<XDocument, XElement?> select)
    {
        if (string.IsNullOrWhiteSpace(xml)) return null;

        try
        {
            var element = select(XDocument.Parse(xml));
            if (element is null) return null;

            var text = string.Join(
                " ",
                element.Value.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        catch (System.Xml.XmlException)
        {
            return null;
        }
    }

    public Task<IReadOnlyList<LiveDiagnostic>> GetLiveDiagnosticsAsync(string fileId, string content)
    {
        var cancellationToken = BeginRequest($"diagnostics:{fileId}");
        var document = TransientDocument(fileId, content);

        return Task.Run<IReadOnlyList<LiveDiagnostic>>(async () =>
        {
            try
            {
                var model = await document.GetSemanticModelAsync(cancellationToken).ConfigureAwait(false);
                if (model is null) return [];

                var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);
                return model.GetDiagnostics(cancellationToken: cancellationToken)
                    .Where(d => d.Severity != DiagnosticSeverity.Hidden)
                    .Select(d =>
                    {
                        var (startLine, startColumn, endLine, endColumn) = ToRange(text, d.Location.SourceSpan);
                        return new LiveDiagnostic(d.Severity.ToString().ToLowerInvariant(), d.GetMessage(), startLine, startColumn, endLine, endColumn);
                    })
                    .ToList();
            }
            catch (OperationCanceledException)
            {
                return [];
            }
        }, cancellationToken);
    }

    /// <summary>Hand-rolled "add using" quick fix — Roslyn's own <c>CSharpAddImportCodeFixProvider</c> is
    /// internal and only reachable through MEF/<c>ICodeFixService</c> host composition this workspace
    /// doesn't have, so this resolves candidates directly via <see cref="Compilation.GetSymbolsWithName"/>
    /// (the same "go straight to the public compiler API" approach <see cref="GetSignatureHelpAsync"/> uses).</summary>
    public Task<IReadOnlyList<CodeActionDto>> GetCodeActionsAsync(string fileId, string content, int startOffset, int endOffset)
    {
        var cancellationToken = BeginRequest($"codeactions:{fileId}");
        var document = TransientDocument(fileId, content);

        return Task.Run<IReadOnlyList<CodeActionDto>>(async () =>
        {
            try
            {
                var model = await document.GetSemanticModelAsync(cancellationToken).ConfigureAwait(false);
                if (model is null) return [];

                var text = await document.GetTextAsync(cancellationToken).ConfigureAwait(false);
                var requestSpan = TextSpan.FromBounds(startOffset, endOffset);

                var diagnostic = model.GetDiagnostics(cancellationToken: cancellationToken)
                    .FirstOrDefault(d => d.Id == "CS0246" && d.Location.SourceSpan.OverlapsWith(requestSpan));
                if (diagnostic is null) return [];

                var identifier = text.ToString(diagnostic.Location.SourceSpan);
                // Strip a trailing "<...>"/"[]" that CS0246's span sometimes includes for generic/array uses.
                var genericMarker = identifier.IndexOfAny(['<', '[']);
                if (genericMarker >= 0) identifier = identifier[..genericMarker];
                if (string.IsNullOrWhiteSpace(identifier)) return [];

                var compilation = await document.Project.GetCompilationAsync(cancellationToken).ConfigureAwait(false);
                if (compilation is null) return [];

                var syntaxRoot = await document.GetSyntaxRootAsync(cancellationToken).ConfigureAwait(false) as CompilationUnitSyntax;
                var existingUsings = syntaxRoot?.Usings
                    .Select(u => u.Name?.ToString())
                    .Where(n => n is not null)
                    .ToHashSet(StringComparer.Ordinal) ?? [];

                var candidateNamespaces = compilation.GetSymbolsWithName(name => name == identifier, SymbolFilter.Type, cancellationToken)
                    .Select(symbol => symbol.ContainingNamespace)
                    .Where(ns => ns is { IsGlobalNamespace: false })
                    .Select(ns => ns!.ToDisplayString())
                    .Distinct(StringComparer.Ordinal)
                    .Where(ns => !existingUsings.Contains(ns))
                    .OrderBy(ns => ns, StringComparer.Ordinal)
                    .Take(5)
                    .ToList();

                if (candidateNamespaces.Count == 0) return [];

                var insertOffset = syntaxRoot?.Usings.Count > 0 ? syntaxRoot.Usings[^1].FullSpan.End : 0;
                var (insertLine, insertColumn, _, _) = ToRange(text, new TextSpan(insertOffset, 0));

                return candidateNamespaces
                    .Select(ns => new CodeActionDto(
                        $"using {ns};",
                        [new TextEditDto(insertLine, insertColumn, insertLine, insertColumn, $"using {ns};\n")]))
                    .ToList<CodeActionDto>();
            }
            catch (OperationCanceledException)
            {
                return [];
            }
        }, cancellationToken);
    }

    /// <summary>
    /// Projects unsaved editor content onto the current solution without mutating workspace
    /// state, so language queries always see what's on screen rather than the last debounced
    /// <see cref="UpdateFileContent"/> sync.
    /// </summary>
    private Document TransientDocument(string fileId, string content)
    {
        EnsureProject();
        var docId = ResolveFileId(fileId);
        var solution = _workspace!.CurrentSolution.WithDocumentText(docId, SourceText.From(content));
        return solution.GetDocument(docId)!;
    }

    private static (int StartLine, int StartColumn, int EndLine, int EndColumn) ToRange(SourceText text, TextSpan span)
    {
        var start = text.Lines.GetLinePosition(span.Start);
        var end = text.Lines.GetLinePosition(span.End);
        return (start.Line + 1, start.Character + 1, end.Line + 1, end.Character + 1);
    }

    private async Task<(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics, byte[]? AssemblyBytes)> EmitAsync()
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

        return (emitResult.Success, diagnostics, emitResult.Success ? peStream.ToArray() : null);
    }

    private static async Task<RunResult> ExecuteAsync(
        byte[] assemblyBytes, IReadOnlyList<byte[]> dependencyAssemblies, IReadOnlyList<CompileDiagnostic> diagnostics)
    {
        // A fresh, isolated context per run: MetadataReference.CreateFromImage satisfies the compiler,
        // but the runtime still needs the referenced projects' actual assemblies loaded to resolve types
        // at execution time. A dedicated context (rather than the default one) also lets repeated runs
        // reload same-named project assemblies without identity clashes across the page's lifetime.
        var context = new AssemblyLoadContext($"zero-run-{Guid.NewGuid():n}");
        foreach (var dependencyBytes in dependencyAssemblies)
        {
            using var dependencyStream = new MemoryStream(dependencyBytes);
            context.LoadFromStream(dependencyStream);
        }

        using var assemblyStream = new MemoryStream(assemblyBytes);
        var assembly = context.LoadFromStream(assemblyStream);
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
        _hiddenDocumentIds.Clear();
        _roslynProjectId = null;
        _lastCompiledAssembly = null;
        _packageManager.Reset();
        _projectReferenceMetadata.Clear();
        _csprojFileId = "";
        _csprojFileName = "";
        _csprojContent = "";
    }

    private void InitializeCsproj(string name, ProjectType projectType)
    {
        _csprojFileId = Guid.NewGuid().ToString("n");
        _csprojFileName = $"{name}.csproj";
        _csprojContent = BuildCsprojContent(projectType);
    }

    /// <summary>Rewrites the &lt;ProjectReference&gt; items in the .csproj to match
    /// <see cref="SolutionWorkspace"/>'s current reference graph for this project. Purely
    /// generated/display text — unlike packages, hand-edited ProjectReference items aren't parsed
    /// back into the graph, since paths here don't map to real files on disk.</summary>
    private void RegenerateCsprojProjectReferences(IReadOnlyList<string> referencedProjectNames)
    {
        XDocument doc;
        try
        {
            doc = XDocument.Parse(_csprojContent);
        }
        catch (System.Xml.XmlException)
        {
            return;
        }

        var root = doc.Root;
        if (root is null) return;

        var projectRefs = root.Elements("ItemGroup").Elements("ProjectReference").ToList();
        var refItemGroup = projectRefs.Count > 0 ? projectRefs[0].Parent : null;
        foreach (var projectRef in projectRefs)
            projectRef.Remove();

        if (referencedProjectNames.Count == 0)
        {
            if (refItemGroup is { HasElements: false })
                refItemGroup.Remove();
        }
        else
        {
            var itemGroup = refItemGroup;
            if (itemGroup is null)
            {
                itemGroup = new XElement("ItemGroup");
                root.Add(itemGroup);
            }

            foreach (var name in referencedProjectNames.OrderBy(n => n, StringComparer.OrdinalIgnoreCase))
                itemGroup.Add(new XElement("ProjectReference", new XAttribute("Include", $"..\\{name}\\{name}.csproj")));
        }

        _csprojContent = doc.ToString() + "\n";
        _lastCompiledAssembly = null;
    }

    /// <summary>Rewrites the &lt;PackageReference&gt; items in the .csproj to match the package
    /// manager's current direct packages — called whenever installs/uninstalls originate from the
    /// NuGet panel (as opposed to the user hand-editing the .csproj, which is the reverse direction
    /// handled by <see cref="SyncPackagesFromCsprojAsync"/>).</summary>
    private void RegenerateCsprojPackageReferences()
    {
        XDocument doc;
        try
        {
            doc = XDocument.Parse(_csprojContent);
        }
        catch (System.Xml.XmlException)
        {
            // The user broke the XML by hand; leave their text alone rather than clobbering it.
            return;
        }

        var root = doc.Root;
        if (root is null) return;

        var packageRefs = root.Elements("ItemGroup").Elements("PackageReference").ToList();
        var packageItemGroup = packageRefs.Count > 0 ? packageRefs[0].Parent : null;
        foreach (var packageRef in packageRefs)
            packageRef.Remove();

        var directPackages = _packageManager.DirectPackages
            .OrderBy(p => p.Id, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (directPackages.Count == 0)
        {
            if (packageItemGroup is { HasElements: false })
                packageItemGroup.Remove();
        }
        else
        {
            var itemGroup = packageItemGroup;
            if (itemGroup is null)
            {
                itemGroup = new XElement("ItemGroup");
                root.Add(itemGroup);
            }

            foreach (var package in directPackages)
            {
                itemGroup.Add(new XElement(
                    "PackageReference",
                    new XAttribute("Include", package.Id),
                    new XAttribute("Version", package.Version)));
            }
        }

        _csprojContent = doc.ToString() + "\n";
    }

    /// <summary>Parses &lt;PackageReference&gt; items out of hand-edited .csproj text and installs/
    /// uninstalls packages to match — the reverse of <see cref="RegenerateCsprojPackageReferences"/>.
    /// Invalid XML (e.g. mid-keystroke) or an unresolvable id/version is ignored rather than thrown,
    /// since this runs on every debounced edit of the file.</summary>
    private async Task SyncPackagesFromCsprojAsync(string content)
    {
        List<(string Id, string Version)> parsed;
        try
        {
            var doc = XDocument.Parse(content);
            parsed = (doc.Root?.Elements("ItemGroup").Elements("PackageReference") ?? Enumerable.Empty<XElement>())
                .Select(e => (Id: (string?)e.Attribute("Include"), Version: (string?)e.Attribute("Version")))
                .Where(p => !string.IsNullOrWhiteSpace(p.Id) && !string.IsNullOrWhiteSpace(p.Version))
                .Select(p => (p.Id!, p.Version!))
                .ToList();
        }
        catch (System.Xml.XmlException)
        {
            return;
        }

        var parsedIds = parsed.Select(p => p.Id).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var current = _packageManager.DirectPackages;
        var changed = false;

        foreach (var package in current.Where(p => !parsedIds.Contains(p.Id)))
        {
            _packageManager.Uninstall(package.Id);
            changed = true;
        }

        foreach (var (id, version) in parsed)
        {
            var existing = current.FirstOrDefault(p => string.Equals(p.Id, id, StringComparison.OrdinalIgnoreCase));
            if (existing is not null && existing.Version == version) continue;

            if (existing is not null)
                _packageManager.Uninstall(id);

            try
            {
                await _packageManager.InstallAsync(id, version).ConfigureAwait(false);
                changed = true;
            }
            catch (Exception)
            {
                // Unresolvable id/version typed by hand — leave it; it just won't compile until fixed.
            }
        }

        if (changed)
            ApplyReferences();
    }

    private void AddHiddenGlobalUsings()
    {
        var documentId = DocumentId.CreateNewId(_roslynProjectId!);
        var documentInfo = DocumentInfo.Create(
            documentId,
            GlobalUsingsFileName,
            sourceCodeKind: SourceCodeKind.Regular,
            loader: TextLoader.From(TextAndVersion.Create(SourceText.From(GetGlobalUsingsContent(_projectType)), VersionStamp.Create())));

        _workspace!.AddDocument(documentInfo);
        _hiddenDocumentIds.Add(documentId);
    }

    private ProjectInfo BuildProjectInfo(ProjectId projectId, string name) => ProjectInfo.Create(
        projectId,
        VersionStamp.Create(),
        name,
        name,
        LanguageNames.CSharp,
        compilationOptions: new CSharpCompilationOptions(GetOutputKind(_projectType), nullableContextOptions: NullableContextOptions.Enable),
        parseOptions: new CSharpParseOptions(LanguageVersion.Latest),
        metadataReferences: GetBaseMetadataReferences(_projectType));

    private static OutputKind GetOutputKind(ProjectType type) => type switch
    {
        ProjectType.LibraryNet10 or ProjectType.LibraryNetStandard20 or ProjectType.LibraryNetStandard21 => OutputKind.DynamicallyLinkedLibrary,
        _ => OutputKind.ConsoleApplication,
    };

    private static (string FileName, string Content) GetDefaultFile(ProjectType type) => type switch
    {
        ProjectType.LibraryNet10 or ProjectType.LibraryNetStandard20 or ProjectType.LibraryNetStandard21 =>
            ("Class1.cs", "public class Class1\n{\n}\n"),
        ProjectType.WebApiNet10 =>
            ("Program.cs",
                "var builder = WebApplication.CreateBuilder(args);\n" +
                "\n" +
                "var app = builder.Build();\n" +
                "\n" +
                "app.MapGet(\"/\", () => \"Hello, World!\");\n" +
                "\n" +
                "app.Run();\n"),
        _ => ("Program.cs", "Console.WriteLine(\"Hello, World!\");\n"),
    };

    private static string GetGlobalUsingsContent(ProjectType type)
    {
        var usings =
            "global using System;\n" +
            "global using System.Collections.Generic;\n" +
            "global using System.IO;\n" +
            "global using System.Linq;\n" +
            "global using System.Threading;\n" +
            "global using System.Threading.Tasks;\n";

        if (type == ProjectType.WebApiNet10)
        {
            usings +=
                "global using Microsoft.AspNetCore.Builder;\n" +
                "global using Microsoft.AspNetCore.Hosting;\n" +
                "global using Microsoft.AspNetCore.Http;\n" +
                "global using Microsoft.Extensions.Configuration;\n" +
                "global using Microsoft.Extensions.DependencyInjection;\n" +
                "global using Microsoft.Extensions.Hosting;\n" +
                "global using Microsoft.Extensions.Logging;\n";
        }

        return usings;
    }

    private static string BuildCsprojContent(ProjectType type)
    {
        var (sdk, targetFramework, outputTypeLine) = type switch
        {
            ProjectType.ConsoleNet10 => ("Microsoft.NET.Sdk", "net10.0", "    <OutputType>Exe</OutputType>\n"),
            // Explicit even though Library is the SDK default — HydrateProjectAsync (via ParseProjectType)
            // needs it to tell LibraryNet10 apart from ConsoleNet10 when both target net10.0.
            ProjectType.LibraryNet10 => ("Microsoft.NET.Sdk", "net10.0", "    <OutputType>Library</OutputType>\n"),
            ProjectType.LibraryNetStandard20 => ("Microsoft.NET.Sdk", "netstandard2.0", ""),
            ProjectType.LibraryNetStandard21 => ("Microsoft.NET.Sdk", "netstandard2.1", ""),
            ProjectType.WebApiNet10 => ("Microsoft.NET.Sdk.Web", "net10.0", ""),
            _ => throw new ArgumentOutOfRangeException(nameof(type), type, null),
        };

        return
            $"<Project Sdk=\"{sdk}\">\n" +
            "\n" +
            "  <PropertyGroup>\n" +
            outputTypeLine +
            $"    <TargetFramework>{targetFramework}</TargetFramework>\n" +
            "    <ImplicitUsings>enable</ImplicitUsings>\n" +
            "    <Nullable>enable</Nullable>\n" +
            "  </PropertyGroup>\n" +
            "\n" +
            "</Project>\n";
    }

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
        var visibleDocuments = project.Documents.Where(d => !_hiddenDocumentIds.Contains(d.Id));

        var fileConflict = visibleDocuments.Any(d =>
            d.Folders.Count == folders.Count &&
            StartsWithPath(d.Folders, folders) &&
            d.Name.Equals(name, StringComparison.OrdinalIgnoreCase) &&
            (excludeFileId is null || _fileIdByDocId[d.Id] != excludeFileId)) ||
            (folders.Count == 0 && _csprojFileId.Length > 0 && excludeFileId != _csprojFileId &&
             name.Equals(_csprojFileName, StringComparison.OrdinalIgnoreCase));

        var folderConflict = _emptyFolders.Any(f =>
        {
            var segments = SplitFolderPath(f);
            return segments.Length == folders.Count + 1 && StartsWithPath(segments, folders) &&
                   segments[^1].Equals(name, StringComparison.OrdinalIgnoreCase);
        }) || visibleDocuments.Any(d =>
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
            if (_hiddenDocumentIds.Contains(document.Id)) continue;
            var folder = EnsureFolderNode(document.Folders);
            folder.Children[document.Name] = new TreeNode { Id = _fileIdByDocId[document.Id], Name = document.Name, Kind = "file" };
        }

        if (_csprojFileId.Length > 0)
        {
            // Sorts after every ordinary file name (regardless of the project's own name) so a
            // fresh project still opens Program.cs by default rather than the .csproj — the UI
            // opens whichever file sorts first in the tree.
            root.Children[_csprojFileName] = new TreeNode { Id = _csprojFileId, Name = _csprojFileName, Kind = "file", SortKey = "￿" + _csprojFileName };
        }

        return root.Children.Values.OrderBy(n => n.Kind == "file").ThenBy(n => n.SortKey, StringComparer.OrdinalIgnoreCase).Select(ToDto).ToList();

        static ProjectFileNode ToDto(TreeNode node) => new(
            node.Id,
            node.Name,
            node.Kind,
            node.Kind == "folder"
                ? node.Children.Values.OrderBy(n => n.Kind == "file").ThenBy(n => n.SortKey, StringComparer.OrdinalIgnoreCase).Select(ToDto).ToList()
                : null);
    }

    private sealed class TreeNode
    {
        public string Id = "";
        public string Name = "";
        public string Kind = "folder";
        private string? _sortKey;
        public string SortKey { get => _sortKey ?? Name; set => _sortKey = value; }
        public Dictionary<string, TreeNode> Children { get; } = new(StringComparer.Ordinal);
    }

    public ProjectDto GetProjectDto() => BuildProjectDto();

    private ProjectDto BuildProjectDto() => new(_projectId, _projectName!, BuildTree(), _packageManager.Installed);

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
