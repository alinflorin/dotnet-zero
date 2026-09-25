using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class LanguageApi
{
    [JSInvokable]
    public static Task<IReadOnlyList<CompletionItemDto>> GetCompletions(string projectId, string fileId, string content, int position, string? triggerCharacter) =>
        ProjectApi.Solution.Project(projectId).GetCompletionsAsync(fileId, content, position, triggerCharacter);

    [JSInvokable]
    public static Task<HoverDto?> GetHover(string projectId, string fileId, string content, int position) =>
        ProjectApi.Solution.Project(projectId).GetHoverAsync(fileId, content, position);

    [JSInvokable]
    public static Task<SignatureHelpDto?> GetSignatureHelp(string projectId, string fileId, string content, int position, string? triggerCharacter, bool isRetrigger) =>
        ProjectApi.Solution.Project(projectId).GetSignatureHelpAsync(fileId, content, position, triggerCharacter, isRetrigger);

    [JSInvokable]
    public static Task<IReadOnlyList<LiveDiagnostic>> GetLiveDiagnostics(string projectId, string fileId, string content) =>
        ProjectApi.Solution.Project(projectId).GetLiveDiagnosticsAsync(fileId, content);
}
