using engine.Debugging;
using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class DebugApi
{
    [JSInvokable]
    public static Task<CompileResult> StartDebug(string? projectId) => ProjectApi.Solution.StartDebugAsync(projectId);

    [JSInvokable]
    public static void SetBreakpoints(string fileId, int[] lines) => ProjectApi.Solution.Debug.SetBreakpoints(fileId, lines);

    [JSInvokable]
    public static DebugStateDto Poll() => ProjectApi.Solution.Debug.Poll();

    [JSInvokable]
    public static void Continue() => ProjectApi.Solution.Debug.Continue();

    [JSInvokable]
    public static void StepOver() => ProjectApi.Solution.Debug.StepOver();

    [JSInvokable]
    public static void StepInto() => ProjectApi.Solution.Debug.StepInto();

    [JSInvokable]
    public static void StepOut() => ProjectApi.Solution.Debug.StepOut();

    [JSInvokable]
    public static void Stop() => ProjectApi.Solution.Debug.Stop();
}
