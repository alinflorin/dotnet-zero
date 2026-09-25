namespace engine.Debugging;

public sealed record VariableDto(string Name, string Preview);

public sealed record CallFrameDto(string MethodName, string FileId, int Line, int Column, IReadOnlyList<VariableDto> Locals);

/// <summary>
/// Unified debug-session state returned by <c>StartDebug</c>/<c>Poll</c>/<c>Continue</c>/step calls.
/// <see cref="Status"/> is one of "idle", "running", "paused", "stopped".
/// </summary>
public sealed record DebugStateDto(string Status, IReadOnlyList<CallFrameDto> CallStack, string Output, bool Success, string? ExceptionMessage);
