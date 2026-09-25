using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class ProjectApi
{
    internal static readonly ProjectWorkspace Workspace = new();

    [JSInvokable]
    public static ProjectDto CreateProject(string name) => Workspace.CreateProject(name);

    [JSInvokable]
    public static Task<ProjectDto> HydrateProject(ProjectSnapshot snapshot) => Workspace.HydrateProjectAsync(snapshot);

    [JSInvokable]
    public static Task<ProjectSnapshot> GetSnapshot() => Workspace.GetSnapshotAsync();

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> GetFileTree() => Workspace.GetFileTree();

    [JSInvokable]
    public static Task<string> GetFileContent(string fileId) => Workspace.GetFileContentAsync(fileId);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> AddFile(string? parentPath, string name) => Workspace.AddFile(parentPath, name);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> AddFolder(string? parentPath, string name) => Workspace.AddFolder(parentPath, name);

    [JSInvokable]
    public static Task UpdateFileContent(string fileId, string content) => Workspace.UpdateFileContent(fileId, content);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> RenameEntry(string id, string newName) => Workspace.RenameEntry(id, newName);

    [JSInvokable]
    public static IReadOnlyList<ProjectFileNode> DeleteEntry(string id) => Workspace.DeleteEntry(id);

    [JSInvokable]
    public static Task<CompileResult> Compile() => Workspace.CompileAsync();

    [JSInvokable]
    public static void Clean() => Workspace.Clean();

    [JSInvokable]
    public static Task<RunResult> Run() => Workspace.RunAsync();

    [JSInvokable]
    public static Task<RunResult> CompileAndRun() => Workspace.CompileAndRunAsync();
}
