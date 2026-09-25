using engine.Debugging;
using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class DebugApi
{
    internal static readonly DebugWorkspace Workspace = new(ProjectApi.Workspace);

    [JSInvokable]
    public static Task<CompileResult> StartDebug() => Workspace.StartDebugAsync();

    [JSInvokable]
    public static void SetBreakpoints(string fileId, int[] lines) => Workspace.SetBreakpoints(fileId, lines);

    [JSInvokable]
    public static DebugStateDto Poll() => Workspace.Poll();

    [JSInvokable]
    public static void Continue() => Workspace.Continue();

    [JSInvokable]
    public static void StepOver() => Workspace.StepOver();

    [JSInvokable]
    public static void StepInto() => Workspace.StepInto();

    [JSInvokable]
    public static void StepOut() => Workspace.StepOut();

    [JSInvokable]
    public static void Stop() => Workspace.Stop();
}
