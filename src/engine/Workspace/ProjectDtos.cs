namespace engine.Workspace;

public sealed record ProjectFileNode(string Id, string Name, string Kind, IReadOnlyList<ProjectFileNode>? Children);

public sealed record ProjectDto(string Id, string Name, IReadOnlyList<ProjectFileNode> Files, IReadOnlyList<InstalledPackageDto> Packages);

public sealed record ProjectFileSnapshot(string Id, string Name, IReadOnlyList<string> Folders, string Content);

public sealed record ProjectSnapshot(
    string Id,
    string Name,
    IReadOnlyList<ProjectFileSnapshot> Files,
    IReadOnlyList<string> EmptyFolders);

/// <summary>The full multi-project workspace: every open project plus the project-reference graph
/// between them (keyed by referencing project id -> the ids it references) and which project
/// Run/Debug targets by default.</summary>
public sealed record SolutionDto(
    string Id,
    string Name,
    IReadOnlyList<ProjectDto> Projects,
    IReadOnlyDictionary<string, IReadOnlyList<string>> ProjectReferences,
    string? StartupProjectId);

public sealed record SolutionSnapshot(
    string Id,
    string Name,
    IReadOnlyList<ProjectSnapshot> Projects,
    IReadOnlyDictionary<string, IReadOnlyList<string>> ProjectReferences,
    string? StartupProjectId);

public sealed record PackageReferenceSnapshot(string Id, string Version);

public sealed record InstalledPackageDto(string Id, string Version, IReadOnlyList<string> AssemblyNames, bool IsDirect);

public sealed record NuGetSearchResultDto(string Id, string Version, string? Description, string? IconUrl, long TotalDownloads, bool Installed);

public sealed record NuGetSearchResponseDto(IReadOnlyList<NuGetSearchResultDto> Results, long TotalHits);

public sealed record CompileDiagnostic(string Severity, string Message, string? FileId, string? FileName, int Line, int Column);

public sealed record CompileResult(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics);

public sealed record RunResult(bool Success, IReadOnlyList<CompileDiagnostic> Diagnostics, string Output, string? ExceptionMessage);

public sealed record CompletionItemDto(string Label, string Kind, string InsertText, string SortText);

public sealed record TextEditDto(int StartLine, int StartColumn, int EndLine, int EndColumn, string NewText);

public sealed record CompletionResolveDto(IReadOnlyList<TextEditDto> AdditionalTextEdits);

public sealed record CodeActionDto(string Title, IReadOnlyList<TextEditDto> Edits);

public sealed record HoverDto(string MarkdownText, int StartLine, int StartColumn, int EndLine, int EndColumn);

public sealed record LiveDiagnostic(string Severity, string Message, int StartLine, int StartColumn, int EndLine, int EndColumn);

public sealed record SignatureParameterDto(int StartOffset, int EndOffset, string? Documentation);

public sealed record SignatureItemDto(string Label, string? Documentation, IReadOnlyList<SignatureParameterDto> Parameters);

public sealed record SignatureHelpDto(IReadOnlyList<SignatureItemDto> Signatures, int ActiveSignature, int ActiveParameter);
