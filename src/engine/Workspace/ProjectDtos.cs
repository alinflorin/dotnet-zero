namespace engine.Workspace;

public sealed record ProjectFileNode(string Id, string Name, string Kind, IReadOnlyList<ProjectFileNode>? Children);

public sealed record ProjectDto(string Id, string Name, IReadOnlyList<ProjectFileNode> Files);

public sealed record ProjectFileSnapshot(string Id, string Name, IReadOnlyList<string> Folders, string Content);

public sealed record ProjectSnapshot(string Id, string Name, IReadOnlyList<ProjectFileSnapshot> Files, IReadOnlyList<string> EmptyFolders);

public sealed record CompileDiagnostic(string Severity, string Message, string? FileId, string? FileName, int Line, int Column);

public sealed record CompileResult(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics);

public sealed record RunResult(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics, string Output, string? ExceptionMessage);
