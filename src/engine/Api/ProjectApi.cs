using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class ProjectApi
{
    internal static readonly SolutionWorkspace Solution = new();

    [JSInvokable]
    public static SolutionDto CreateSolution(string name) => Solution.CreateSolution(name);

    [JSInvokable]
    public static Task<SolutionDto> HydrateSolution(SolutionSnapshot snapshot) => Solution.HydrateAsync(snapshot);

    [JSInvokable]
    public static Task<SolutionSnapshot> GetSolutionSnapshot() => Solution.GetSnapshotAsync();

    [JSInvokable]
    public static SolutionDto AddProject(string name) => Solution.AddProject(name);

    [JSInvokable]
    public static SolutionDto RemoveProject(string projectId) => Solution.RemoveProject(projectId);

    [JSInvokable]
    public static SolutionDto RenameProject(string projectId, string newName) => Solution.RenameProject(projectId, newName);

    [JSInvokable]
    public static SolutionDto SetStartupProject(string projectId) => Solution.SetStartupProject(projectId);

    [JSInvokable]
    public static SolutionDto SetProjectReferences(string projectId, string[] referencedProjectIds) =>
        Solution.SetProjectReferences(projectId, referencedProjectIds);

    [JSInvokable]
    public static string ExportSlnx() => Solution.ExportSlnx();

    [JSInvokable]
    public static Task<byte[]> ExportZip() => Solution.ExportZipAsync();

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> GetFileTree(string projectId) => Solution.Project(projectId).GetFileTree();

    [JSInvokable]
    public static Task<string> GetFileContent(string projectId, string fileId) => Solution.Project(projectId).GetFileContentAsync(fileId);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> AddFile(string projectId, string? parentPath, string name) =>
        Solution.Project(projectId).AddFile(parentPath, name);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> AddFolder(string projectId, string? parentPath, string name) =>
        Solution.Project(projectId).AddFolder(parentPath, name);

    [JSInvokable]
    public static Task UpdateFileContent(string projectId, string fileId, string content) =>
        Solution.Project(projectId).UpdateFileContent(fileId, content);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> RenameEntry(string projectId, string id, string newName) =>
        Solution.Project(projectId).RenameEntry(id, newName);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> DeleteEntry(string projectId, string id) =>
        Solution.Project(projectId).DeleteEntry(id);

    [JSInvokable]
    public static Task<CompileResult> Compile(string projectId) => Solution.CompileAsync(projectId);

    [JSInvokable]
    public static void Clean(string projectId) => Solution.Project(projectId).Clean();

    [JSInvokable]
    public static Task<RunResult> Run(string? projectId) => Solution.RunAsync(projectId);

    [JSInvokable]
    public static Task<RunResult> CompileAndRun(string? projectId) => Solution.CompileAndRunAsync(projectId);
}
