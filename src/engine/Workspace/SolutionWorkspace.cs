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

    private string _solutionId = "";
    private string _solutionName = "Solution";
    private string? _startupProjectId;

    public DebugWorkspace Debug => _debug;

    public ProjectWorkspace Project(string projectId) =>
        _projects.TryGetValue(projectId, out var project) ? project : throw new InvalidOperationException($"Project not found: {projectId}");

    public SolutionDto CreateSolution(string name)
    {
        _projects.Clear();
        _order.Clear();
        _references.Clear();
        _solutionId = Guid.NewGuid().ToString("n");
        _solutionName = name;
        _startupProjectId = null;

        AddProjectCore(name);
        return BuildSolutionDto();
    }

    public SolutionDto AddProject(string name)
    {
        EnsureUniqueProjectName(name);
        AddProjectCore(name);
        return BuildSolutionDto();
    }

    private void AddProjectCore(string name)
    {
        var workspace = new ProjectWorkspace();
        workspace.CreateProject(name);
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
        foreach (var set in _references.Values)
            set.Remove(projectId);

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

    public SolutionDto SetProjectReferences(string projectId, IReadOnlyList<string> referencedProjectIds)
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
        List<string> order;
        try
        {
            order = TopoOrderChecked(projectId);
        }
        catch (InvalidOperationException ex)
        {
            return new CompileResult(false, [new CompileDiagnostic("error", ex.Message, null, null, 0, 0)]);
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
                return new CompileResult(false, allDiagnostics);
            }

            project.SetLastCompiledAssembly(bytes);
            compiledBytes[id] = bytes!;
        }

        return new CompileResult(true, allDiagnostics);
    }

    public async Task<RunResult> RunAsync(string? projectId)
    {
        var targetId = projectId ?? _startupProjectId ?? throw new InvalidOperationException("No startup project is set.");
        var compileResult = await CompileAsync(targetId).ConfigureAwait(false);
        if (!compileResult.Success)
            return new RunResult(false, compileResult.Diagnostics, "", null);

        return await Project(targetId).RunAsync().ConfigureAwait(false);
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

    private IReadOnlyDictionary<string, IReadOnlyList<string>> BuildReferencesDto() =>
        _references.ToDictionary(kv => kv.Key, kv => (IReadOnlyList<string>)kv.Value.ToList(), StringComparer.Ordinal);

    private SolutionDto BuildSolutionDto() => new(
        _solutionId,
        _solutionName,
        _order.Select(id => _projects[id].GetProjectDto()).ToList(),
        BuildReferencesDto(),
        _startupProjectId);
}
