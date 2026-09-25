using engine.Workspace;
using Microsoft.JSInterop;

namespace engine.Api;

public static class LanguageApi
{
    [JSInvokable]
    public static Task<IReadOnlyList<CompletionItemDto>> GetCompletions(string fileId, string content, int position, string? triggerCharacter) =>
        ProjectApi.Workspace.GetCompletionsAsync(fileId, content, position, triggerCharacter);

    [JSInvokable]
    public static Task<HoverDto?> GetHover(string fileId, string content, int position) =>
        ProjectApi.Workspace.GetHoverAsync(fileId, content, position);

    [JSInvokable]
    public static Task<SignatureHelpDto?> GetSignatureHelp(string fileId, string content, int position, string? triggerCharacter, bool isRetrigger) =>
        ProjectApi.Workspace.GetSignatureHelpAsync(fileId, content, position, triggerCharacter, isRetrigger);

    [JSInvokable]
    public static Task<IReadOnlyList<LiveDiagnostic>> GetLiveDiagnostics(string fileId, string content) =>
        ProjectApi.Workspace.GetLiveDiagnosticsAsync(fileId, content);
}
