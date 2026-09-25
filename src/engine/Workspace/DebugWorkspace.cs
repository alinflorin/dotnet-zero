using System.Reflection;
using System.Text.Json;
using engine.Debugging;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Text;

namespace engine.Workspace;

/// <summary>The files and metadata references to debug — the startup project plus every project it
/// (transitively) references, built by <see cref="SolutionWorkspace.StartDebugAsync"/> so breakpoints
/// work in referenced-project code too, not just the startup project's own files.</summary>
public sealed record DebugBundle(IReadOnlyList<ProjectFileSnapshot> Files, IReadOnlyList<MetadataReference> MetadataReferences);

/// <summary>
/// Owns the lifecycle of a single debug session: compiles a debug-only, instrumented copy of
/// the target project bundle (see <see cref="DebugInstrumentationRewriter"/>), runs it on a background
/// thread, and relays breakpoint/step/continue/stop commands to it. Entirely separate from
/// <see cref="ProjectWorkspace"/>'s cached compiled assembly used by normal Compile/Run.
/// </summary>
public sealed class DebugWorkspace
{
    private const string GlobalUsingsContent =
        "global using System;\n" +
        "global using System.Collections.Generic;\n" +
        "global using System.IO;\n" +
        "global using System.Linq;\n" +
        "global using System.Threading;\n" +
        "global using System.Threading.Tasks;\n";

    private readonly Dictionary<string, int[]> _pendingBreakpoints = new(StringComparer.Ordinal);
    private DebugSession? _session;

    public void SetBreakpoints(string fileId, int[] lines)
    {
        _pendingBreakpoints[fileId] = lines;
        _session?.SetBreakpoints(fileId, lines);
    }

    public void Continue() => _session?.Resume("Continue");

    public void StepOver() => _session?.Resume("StepOver");

    public void StepInto() => _session?.Resume("StepInto");

    public void StepOut() => _session?.Resume("StepOut");

    public void Stop()
    {
        _session?.Abort();
        _session = null;
    }

    public DebugStateDto Poll()
    {
        if (_session is null) return new DebugStateDto("idle", [], "", true, null);

        var raw = JsonSerializer.Deserialize<RawState>(_session.PollStateJson())!;
        var frames = raw.CallStack
            .Select(f => new CallFrameDto(f.MethodName, f.FileId, f.Line, f.Column, f.Locals.Select(v => new VariableDto(v.Name, v.Preview)).ToList()))
            .ToList();
        return new DebugStateDto(raw.Status, frames, raw.Output, raw.Success, raw.ExceptionMessage);
    }

    public async Task<CompileResult> StartDebugAsync(DebugBundle bundle)
    {
        Stop();

        var adhoc = new AdhocWorkspace();
        var projectId = ProjectId.CreateNewId("__debug");
        var projectInfo = ProjectInfo.Create(
            projectId,
            VersionStamp.Create(),
            "__debug",
            "__debug",
            LanguageNames.CSharp,
            compilationOptions: new CSharpCompilationOptions(OutputKind.ConsoleApplication, nullableContextOptions: NullableContextOptions.Enable),
            parseOptions: new CSharpParseOptions(LanguageVersion.Latest),
            metadataReferences: bundle.MetadataReferences);
        adhoc.AddProject(projectInfo);

        adhoc.AddDocument(DocumentInfo.Create(
            DocumentId.CreateNewId(projectId),
            "GlobalUsings.g.cs",
            loader: TextLoader.From(TextAndVersion.Create(SourceText.From(GlobalUsingsContent), VersionStamp.Create()))));

        adhoc.AddDocument(DocumentInfo.Create(
            DocumentId.CreateNewId(projectId),
            "__DebugRuntime.g.cs",
            loader: TextLoader.From(TextAndVersion.Create(SourceText.From(DebugRuntimeSource.Code), VersionStamp.Create()))));

        var docIds = new List<(DocumentId Id, string FileId)>();
        foreach (var file in bundle.Files)
        {
            var docId = DocumentId.CreateNewId(projectId);
            adhoc.AddDocument(DocumentInfo.Create(
                docId,
                file.Name,
                folders: file.Folders,
                loader: TextLoader.From(TextAndVersion.Create(SourceText.From(file.Content), VersionStamp.Create()))));
            docIds.Add((docId, file.Id));
        }

        var solution = adhoc.CurrentSolution;
        foreach (var (docId, fileId) in docIds)
        {
            var document = solution.GetDocument(docId)!;
            var root = await document.GetSyntaxRootAsync().ConfigureAwait(false);
            var model = await document.GetSemanticModelAsync().ConfigureAwait(false);
            if (root is null || model is null) continue;

            var rewriter = new DebugInstrumentationRewriter(model, fileId);
            var newRoot = rewriter.Visit(root)!;
            solution = solution.WithDocumentSyntaxRoot(docId, newRoot);
        }

        adhoc.TryApplyChanges(solution);

        var compilation = await adhoc.CurrentSolution.GetProject(projectId)!.GetCompilationAsync().ConfigureAwait(false)
            ?? throw new InvalidOperationException("Debug compilation unavailable.");

        using var peStream = new MemoryStream();
        var emitResult = compilation.Emit(peStream);
        var diagnostics = emitResult.Diagnostics
            .Where(d => d.Severity != DiagnosticSeverity.Hidden)
            .Select(ToCompileDiagnostic)
            .ToList();

        if (!emitResult.Success)
            return new CompileResult(false, diagnostics);

        var assembly = Assembly.Load(peStream.ToArray());
        var hookType = assembly.GetType("__DebugRuntime.DebugHook")
            ?? throw new InvalidOperationException("Debug runtime type missing from compiled assembly.");

        var session = new DebugSession(hookType);
        foreach (var (fileId, lines) in _pendingBreakpoints)
            session.SetBreakpoints(fileId, lines);

        _session = session;

        var entryPoint = assembly.EntryPoint;
        if (entryPoint is null)
        {
            session.ReportFinished(false, "No entry point (Main method) found.");
            return new CompileResult(true, diagnostics);
        }

        _ = Task.Run(() => RunDebuggeeAsync(entryPoint, session));

        return new CompileResult(true, diagnostics);
    }

    private static async Task RunDebuggeeAsync(MethodInfo entryPoint, DebugSession session)
    {
        var previousOut = Console.Out;
        var previousError = Console.Error;
        var writer = new DebugOutputWriter(session.AppendOutput);
        Console.SetOut(writer);
        Console.SetError(writer);

        string? exceptionMessage = null;
        try
        {
            var parameters = entryPoint.GetParameters().Length == 0 ? null : new object?[] { Array.Empty<string>() };
            var result = entryPoint.Invoke(null, parameters);
            if (result is Task task)
                await task.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            exceptionMessage = "Stopped.";
        }
        catch (TargetInvocationException ex)
        {
            exceptionMessage = (ex.InnerException ?? ex).ToString();
        }
        catch (Exception ex)
        {
            exceptionMessage = ex.ToString();
        }
        finally
        {
            Console.SetOut(previousOut);
            Console.SetError(previousError);
            session.ReportFinished(exceptionMessage is null, exceptionMessage);
        }
    }

    private static CompileDiagnostic ToCompileDiagnostic(Diagnostic diagnostic)
    {
        var lineSpan = diagnostic.Location.GetLineSpan();
        return new CompileDiagnostic(
            diagnostic.Severity.ToString().ToLowerInvariant(),
            diagnostic.GetMessage(),
            null,
            diagnostic.Location.SourceTree?.FilePath,
            lineSpan.StartLinePosition.Line + 1,
            lineSpan.StartLinePosition.Character + 1);
    }

    /// <summary>Thin reflection handle onto a single debug session's dynamically-compiled <c>__DebugRuntime.DebugHook</c>.</summary>
    private sealed class DebugSession
    {
        private readonly MethodInfo _setBreakpoints;
        private readonly MethodInfo _resume;
        private readonly MethodInfo _abort;
        private readonly MethodInfo _appendOutput;
        private readonly MethodInfo _pollStateJson;
        private readonly MethodInfo _reportFinished;

        public DebugSession(Type hookType)
        {
            _setBreakpoints = hookType.GetMethod("SetBreakpoints")!;
            _resume = hookType.GetMethod("Resume")!;
            _abort = hookType.GetMethod("Abort")!;
            _appendOutput = hookType.GetMethod("AppendOutput")!;
            _pollStateJson = hookType.GetMethod("PollStateJson")!;
            _reportFinished = hookType.GetMethod("ReportFinished")!;
        }

        public void SetBreakpoints(string fileId, int[] lines) => _setBreakpoints.Invoke(null, [fileId, lines]);

        public void Resume(string mode) => _resume.Invoke(null, [mode]);

        public void Abort() => _abort.Invoke(null, null);

        public void AppendOutput(string chunk) => _appendOutput.Invoke(null, [chunk]);

        public string PollStateJson() => (string)_pollStateJson.Invoke(null, null)!;

        public void ReportFinished(bool success, string? exceptionMessage) => _reportFinished.Invoke(null, [success, exceptionMessage]);
    }

    private sealed class RawState
    {
        public string Status { get; set; } = "";
        public RawFrame[] CallStack { get; set; } = [];
        public string Output { get; set; } = "";
        public bool Success { get; set; }
        public string? ExceptionMessage { get; set; }
    }

    private sealed class RawFrame
    {
        public string MethodName { get; set; } = "";
        public string FileId { get; set; } = "";
        public int Line { get; set; }
        public int Column { get; set; }
        public RawVariable[] Locals { get; set; } = [];
    }

    private sealed class RawVariable
    {
        public string Name { get; set; } = "";
        public string Preview { get; set; } = "";
    }
}
