using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;

namespace engine.Workspace;

/// <summary>
/// Owns every open <see cref="ProjectWorkspace"/> in the current solution plus the project-reference
/// graph between them, and is the entry point for solution-level operations (add/remove/rename a
/// project, pick the startup project, compile/run/debug with dependencies resolved). Per-file/per-package
/// operations are delegated straight to the target project via <see cref="Project"/>.
/// </summary>
public sealed class SolutionWorkspace
{
    private readonly Dictionary<string, ProjectWorkspace> _projects = new(StringComparer.Ordinal);
    private readonly List<string> _order = new();

    // Keyed by referencing project id -> the set of project ids it references.
    private readonly Dictionary<string, HashSet<string>> _references = new(StringComparer.Ordinal);
    private readonly DebugWorkspace _debug = new();

    // Projects whose ProjectWorkspace.GetMetadataReferences() may not reflect the referenced
    // projects' current compiled types yet (reference graph just changed, solution just loaded, or
    // a project it depends on was just edited) — refreshed lazily, right before the next language
    // query for that project, by EnsureReferenceMetadataFreshAsync.
    private readonly HashSet<string> _dirtyReferenceProjects = new(StringComparer.Ordinal);

    private string _solutionId = "";
    private string _solutionName = "Solution";
    private string? _startupProjectId;

    public DebugWorkspace Debug => _debug;

    public ProjectWorkspace Project(string projectId) =>
        _projects.TryGetValue(projectId, out var project) ? project : throw new InvalidOperationException($"Project not found: {projectId}");

    public SolutionDto CreateSolution(string name, ProjectType projectType = ProjectType.ConsoleNet10)
    {
        _projects.Clear();
        _order.Clear();
        _references.Clear();
        _solutionId = Guid.NewGuid().ToString("n");
        _solutionName = name;
        _startupProjectId = null;

        AddProjectCore(name, projectType);
        return BuildSolutionDto();
    }

    public SolutionDto AddProject(string name, ProjectType projectType = ProjectType.ConsoleNet10)
    {
        EnsureUniqueProjectName(name);
        AddProjectCore(name, projectType);
        return BuildSolutionDto();
    }

    private void AddProjectCore(string name, ProjectType projectType)
    {
        var workspace = new ProjectWorkspace();
        workspace.CreateProject(name, projectType);
        _projects[workspace.Id] = workspace;
        _order.Add(workspace.Id);
        _references[workspace.Id] = new HashSet<string>(StringComparer.Ordinal);
        _startupProjectId ??= workspace.Id;
    }

    public SolutionDto RemoveProject(string projectId)
    {
        if (!_projects.ContainsKey(projectId))
            throw new InvalidOperationException("Project not found.");
        if (_order.Count <= 1)
            throw new InvalidOperationException("The solution must contain at least one project.");

        _projects.Remove(projectId);
        _order.Remove(projectId);
        _references.Remove(projectId);
        _dirtyReferenceProjects.Remove(projectId);
        foreach (var (referencer, set) in _references)
        {
            if (set.Remove(projectId))
                _dirtyReferenceProjects.Add(referencer);
        }

        if (_startupProjectId == projectId)
            _startupProjectId = _order.FirstOrDefault();

        SyncAllReferenceCsprojText();
        return BuildSolutionDto();
    }

    public SolutionDto RenameProject(string projectId, string newName)
    {
        EnsureUniqueProjectName(newName, excludeProjectId: projectId);
        Project(projectId).Rename(newName);
        SyncAllReferenceCsprojText();
        return BuildSolutionDto();
    }

    public SolutionDto SetStartupProject(string projectId)
    {
        if (!_projects.ContainsKey(projectId))
            throw new InvalidOperationException("Project not found.");
        _startupProjectId = projectId;
        return BuildSolutionDto();
    }

    public async Task<SolutionDto> SetProjectReferences(string projectId, IReadOnlyList<string> referencedProjectIds)
    {
        if (!_projects.ContainsKey(projectId))
            throw new InvalidOperationException("Project not found.");
        foreach (var id in referencedProjectIds)
        {
            if (id == projectId)
                throw new InvalidOperationException("A project cannot reference itself.");
            if (!_projects.ContainsKey(id))
                throw new InvalidOperationException("Referenced project not found.");
        }

        var previous = _references[projectId];
        _references[projectId] = new HashSet<string>(referencedProjectIds, StringComparer.Ordinal);
        try
        {
            TopoOrderChecked(projectId);
        }
        catch (InvalidOperationException)
        {
            _references[projectId] = previous;
            throw new InvalidOperationException("That reference would create a circular dependency between projects.");
        }

        SyncReferenceCsprojText(projectId);

        // Newly-referenced projects' types should show up without requiring an explicit Compile/Run first.
        _dirtyReferenceProjects.Add(projectId);
        await EnsureReferenceMetadataFreshAsync(projectId).ConfigureAwait(false);
        return BuildSolutionDto();
    }

    private void SyncAllReferenceCsprojText()
    {
        foreach (var id in _order)
            SyncReferenceCsprojText(id);
    }

    private void SyncReferenceCsprojText(string projectId)
    {
        var names = _references[projectId]
            .Where(_projects.ContainsKey)
            .Select(id => _projects[id].Name)
            .ToList();
        Project(projectId).SetProjectReferenceNames(names);
    }

    private void EnsureUniqueProjectName(string name, string? excludeProjectId = null)
    {
        var conflict = _order
            .Where(id => id != excludeProjectId)
            .Select(id => _projects[id].Name)
            .Any(existing => existing.Equals(name, StringComparison.OrdinalIgnoreCase));
        if (conflict)
            throw new InvalidOperationException($"A project named '{name}' already exists in the solution.");
    }

    /// <summary>Depth-first topological order of <paramref name="projectId"/> and everything it depends
    /// on (directly or transitively), dependencies first. Throws if the reference graph reachable from
    /// it contains a cycle.</summary>
    private List<string> TopoOrderChecked(string projectId)
    {
        var result = new List<string>();
        var visited = new HashSet<string>(StringComparer.Ordinal);
        var visiting = new HashSet<string>(StringComparer.Ordinal);

        void Visit(string id)
        {
            if (visited.Contains(id)) return;
            if (!visiting.Add(id))
                throw new InvalidOperationException("The project reference graph has a circular dependency.");

            foreach (var dependency in _references.TryGetValue(id, out var set) ? set : [])
                Visit(dependency);

            visiting.Remove(id);
            visited.Add(id);
            result.Add(id);
        }

        Visit(projectId);
        return result;
    }

    public async Task<CompileResult> CompileAsync(string projectId)
    {
        var (success, diagnostics, _) = await CompileGraphAsync(projectId).ConfigureAwait(false);
        return new CompileResult(success, diagnostics);
    }

    /// <summary>Compiles <paramref name="projectId"/> and every project it (transitively) depends on,
    /// dependencies first, wiring each one's compiled bytes into its dependents as it goes. Returns every
    /// compiled assembly's bytes (not just the target's) so a caller running the target can also load its
    /// dependencies into the runtime — <see cref="ProjectWorkspace.SetProjectReferenceAssemblies"/> only
    /// feeds the compiler, execution needs the actual assemblies loaded too.</summary>
    private async Task<(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics, Dictionary<string, byte[]>? CompiledBytes)> CompileGraphAsync(string projectId)
    {
        List<string> order;
        try
        {
            order = TopoOrderChecked(projectId);
        }
        catch (InvalidOperationException ex)
        {
            return (false, [new CompileDiagnostic("error", ex.Message, null, null, 0, 0)], null);
        }

        var compiledBytes = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        var allDiagnostics = new List<CompileDiagnostic>();

        foreach (var id in order)
        {
            var project = Project(id);
            var referenceBytes = _references[id]
                .Where(compiledBytes.ContainsKey)
                .Select(refId => compiledBytes[refId])
                .ToList();
            project.SetProjectReferenceAssemblies(referenceBytes);

            var (success, diagnostics, bytes) = await project.EmitForBuildAsync().ConfigureAwait(false);
            var isTarget = id == projectId;
            allDiagnostics.AddRange(isTarget ? diagnostics : diagnostics.Select(d => d with { Message = $"{project.Name}: {d.Message}" }));

            if (!success)
            {
                project.SetLastCompiledAssembly(null);
                return (false, allDiagnostics, null);
            }

            project.SetLastCompiledAssembly(bytes);
            compiledBytes[id] = bytes!;
        }

        return (true, allDiagnostics, compiledBytes);
    }

    /// <summary>Recompiles <paramref name="projectId"/>'s dependency chain and re-wires the resulting
    /// bytes as its metadata references (same mechanism as <see cref="CompileGraphAsync"/>, used by
    /// Compile/Run/Debug) so language queries (diagnostics/completions/hover/signature help) see
    /// referenced projects' types without the user having to Compile/Run first. A no-op if nothing is
    /// dirty; best-effort otherwise — a dependency with compile errors just leaves this project's view
    /// of it stale until the error is fixed, rather than failing the language query.</summary>
    private async Task EnsureReferenceMetadataFreshAsync(string projectId)
    {
        if (!_dirtyReferenceProjects.Contains(projectId)) return;

        try
        {
            var (success, _, _) = await CompileGraphAsync(projectId).ConfigureAwait(false);
            if (success)
                _dirtyReferenceProjects.Remove(projectId);
        }
        catch
        {
            // Best-effort refresh — leave it dirty so the next language query retries.
        }
    }

    /// <summary>Marks every project that (transitively) references <paramref name="projectId"/> as
    /// needing a metadata refresh, since its compiled output may have just changed. The graph is a DAG
    /// (enforced in <see cref="SetProjectReferences"/>), so this always terminates.</summary>
    private void MarkDependentsStale(string projectId)
    {
        foreach (var (referencer, dependencies) in _references)
        {
            if (dependencies.Contains(projectId) && _dirtyReferenceProjects.Add(referencer))
                MarkDependentsStale(referencer);
        }
    }

    public Task<IReadOnlyList<CompletionItemDto>> GetCompletionsAsync(string projectId, string fileId, string content, int position, string? triggerCharacter) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).GetCompletionsAsync(fileId, content, position, triggerCharacter));

    public Task<HoverDto?> GetHoverAsync(string projectId, string fileId, string content, int position) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).GetHoverAsync(fileId, content, position));

    public Task<SignatureHelpDto?> GetSignatureHelpAsync(string projectId, string fileId, string content, int position, string? triggerCharacter, bool isRetrigger) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).GetSignatureHelpAsync(fileId, content, position, triggerCharacter, isRetrigger));

    public Task<IReadOnlyList<LiveDiagnostic>> GetLiveDiagnosticsAsync(string projectId, string fileId, string content) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).GetLiveDiagnosticsAsync(fileId, content));

    public Task<CompletionResolveDto?> ResolveCompletionAsync(string projectId, string fileId, string content, int position, string label, string sortText) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).ResolveCompletionAsync(fileId, content, position, label, sortText));

    public Task<IReadOnlyList<CodeActionDto>> GetCodeActionsAsync(string projectId, string fileId, string content, int startOffset, int endOffset) =>
        WithFreshReferenceMetadataAsync(projectId, () => Project(projectId).GetCodeActionsAsync(fileId, content, startOffset, endOffset));

    private async Task<T> WithFreshReferenceMetadataAsync<T>(string projectId, Func<Task<T>> query)
    {
        await EnsureReferenceMetadataFreshAsync(projectId).ConfigureAwait(false);
        return await query().ConfigureAwait(false);
    }

    public IReadOnlyList<ProjectFileNode> AddFile(string projectId, string? parentPath, string name)
    {
        var result = Project(projectId).AddFile(parentPath, name);
        MarkDependentsStale(projectId);
        return result;
    }

    public async Task UpdateFileContent(string projectId, string fileId, string content)
    {
        await Project(projectId).UpdateFileContent(fileId, content).ConfigureAwait(false);
        MarkDependentsStale(projectId);
    }

    public IReadOnlyList<ProjectFileNode> RenameEntry(string projectId, string id, string newName)
    {
        var result = Project(projectId).RenameEntry(id, newName);
        MarkDependentsStale(projectId);
        return result;
    }

    public IReadOnlyList<ProjectFileNode> DeleteEntry(string projectId, string id)
    {
        var result = Project(projectId).DeleteEntry(id);
        MarkDependentsStale(projectId);
        return result;
    }

    public async Task<RunResult> RunAsync(string? projectId)
    {
        var targetId = projectId ?? _startupProjectId ?? throw new InvalidOperationException("No startup project is set.");
        var (success, diagnostics, compiledBytes) = await CompileGraphAsync(targetId).ConfigureAwait(false);
        if (!success || compiledBytes is null)
            return new RunResult(false, diagnostics, "", null);

        var dependencyBytes = compiledBytes.Where(kv => kv.Key != targetId).Select(kv => kv.Value).ToList();
        return await Project(targetId).RunAsync(dependencyBytes).ConfigureAwait(false);
    }

    public Task<RunResult> CompileAndRunAsync(string? projectId) => RunAsync(projectId);

    public async Task<CompileResult> StartDebugAsync(string? projectId)
    {
        var targetId = projectId ?? _startupProjectId ?? throw new InvalidOperationException("No startup project is set.");
        List<string> order;
        try
        {
            order = TopoOrderChecked(targetId);
        }
        catch (InvalidOperationException ex)
        {
            return new CompileResult(false, [new CompileDiagnostic("error", ex.Message, null, null, 0, 0)]);
        }

        var files = new List<ProjectFileSnapshot>();
        var metadataReferences = new List<MetadataReference>();
        var seenReferences = new HashSet<MetadataReference>();

        foreach (var id in order)
        {
            var project = Project(id);
            var snapshot = await project.GetSnapshotAsync().ConfigureAwait(false);
            var isTarget = id == targetId;

            foreach (var file in snapshot.Files)
            {
                if (file.Folders.Count == 0 && file.Name.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase))
                    continue;

                files.Add(isTarget ? file : file with { Folders = [project.Name, .. file.Folders] });
            }

            foreach (var reference in project.GetMetadataReferences())
            {
                if (seenReferences.Add(reference))
                    metadataReferences.Add(reference);
            }
        }

        return await _debug.StartDebugAsync(new DebugBundle(files, metadataReferences)).ConfigureAwait(false);
    }

    public async Task<SolutionSnapshot> GetSnapshotAsync()
    {
        var projectSnapshots = new List<ProjectSnapshot>();
        foreach (var id in _order)
            projectSnapshots.Add(await _projects[id].GetSnapshotAsync().ConfigureAwait(false));

        return new SolutionSnapshot(_solutionId, _solutionName, projectSnapshots, BuildReferencesDto(), _startupProjectId);
    }

    public async Task<SolutionDto> HydrateAsync(SolutionSnapshot snapshot)
    {
        _projects.Clear();
        _order.Clear();
        _references.Clear();
        _solutionId = snapshot.Id;
        _solutionName = snapshot.Name;

        foreach (var projectSnapshot in snapshot.Projects)
        {
            var workspace = new ProjectWorkspace();
            await workspace.HydrateProjectAsync(projectSnapshot).ConfigureAwait(false);
            _projects[workspace.Id] = workspace;
            _order.Add(workspace.Id);
        }

        foreach (var id in _order)
        {
            _references[id] = new HashSet<string>(
                snapshot.ProjectReferences.TryGetValue(id, out var refs) ? refs.Where(_projects.ContainsKey) : [],
                StringComparer.Ordinal);
        }

        _startupProjectId = snapshot.StartupProjectId is { } startupId && _projects.ContainsKey(startupId)
            ? startupId
            : _order.FirstOrDefault();

        // Every ProjectWorkspace starts with no referenced-project metadata (SolutionSnapshot doesn't
        // carry compiled bytes), so seed diagnostics/completions for referencing projects right away
        // instead of leaving them to show missing-type errors until the user Compiles/Runs.
        foreach (var id in _order)
        {
            if (_references[id].Count > 0)
                _dirtyReferenceProjects.Add(id);
        }
        foreach (var id in _order)
            await EnsureReferenceMetadataFreshAsync(id).ConfigureAwait(false);

        return BuildSolutionDto();
    }

    /// <summary>Generates a real, minimal .slnx (VS's XML solution format) listing every project's
    /// virtual path. Cross-project references live in each project's own .csproj (see
    /// <see cref="ProjectWorkspace.SetProjectReferenceNames"/>), same as a real solution — this file is
    /// for download/interop, not this app's own save mechanism (that's the snapshot above).</summary>
    public string ExportSlnx()
    {
        var solutionElement = new XElement(
            "Solution",
            _order.Select(id => new XElement("Project", new XAttribute("Path", $"{_projects[id].Name}/{_projects[id].Name}.csproj"))));

        return "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" + solutionElement + "\n";
    }

    /// <summary>Zips every project's files (via the same snapshot content used for persistence) plus
    /// the .slnx, laid out as {ProjectName}/{folders}/{file} so the archive extracts into a normal
    /// solution folder on disk.</summary>
    public async Task<byte[]> ExportZipAsync()
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var slnxEntry = archive.CreateEntry($"{_solutionName}.slnx", CompressionLevel.Optimal);
            await using (var slnxWriter = new StreamWriter(slnxEntry.Open(), Encoding.UTF8))
                await slnxWriter.WriteAsync(ExportSlnx()).ConfigureAwait(false);

            foreach (var id in _order)
            {
                var project = _projects[id];
                var snapshot = await project.GetSnapshotAsync().ConfigureAwait(false);

                foreach (var folder in snapshot.EmptyFolders)
                    archive.CreateEntry($"{project.Name}/{folder}/.gitkeep", CompressionLevel.Optimal);

                foreach (var file in snapshot.Files)
                {
                    var entryPath = file.Folders.Count == 0
                        ? $"{project.Name}/{file.Name}"
                        : $"{project.Name}/{string.Join('/', file.Folders)}/{file.Name}";
                    var entry = archive.CreateEntry(entryPath, CompressionLevel.Optimal);
                    await using var writer = new StreamWriter(entry.Open(), Encoding.UTF8);
                    await writer.WriteAsync(file.Content).ConfigureAwait(false);
                }
            }
        }

        return stream.ToArray();
    }

    private IReadOnlyDictionary<string, IReadOnlyList<string>> BuildReferencesDto() =>
        _references.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<string>)kv.Value.ToList(), StringComparer.Ordinal);

    private SolutionDto BuildSolutionDto() => new(
        _solutionId,
        _solutionName,
        _order.Select(id => _projects[id].GetProjectDto()).ToList(),
        BuildReferencesDto(),
        _startupProjectId);
}
