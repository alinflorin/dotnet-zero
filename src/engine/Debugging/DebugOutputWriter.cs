using System.Text;

namespace engine.Debugging;

/// <summary>
/// Redirects <see cref="Console.Out"/>/<see cref="Console.Error"/> during a debug run, forwarding
/// each write into the debug session's runtime buffer (read back via <c>PollStateJson</c>)
/// instead of accumulating into a single <see cref="StringWriter"/> only returned at the end,
/// as the normal (non-debug) <c>ProjectWorkspace.ExecuteAsync</c> does.
/// </summary>
public sealed class DebugOutputWriter(Action<string> onChunk) : TextWriter
{
    public override Encoding Encoding => Encoding.UTF8;

    public override void Write(char value) => onChunk(value.ToString());

    public override void Write(string? value)
    {
        if (!string.IsNullOrEmpty(value)) onChunk(value);
    }
}
