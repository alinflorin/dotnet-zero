namespace engine.Debugging;

/// <summary>
/// Source of the debug runtime hook (<c>__DebugRuntime.DebugHook</c>), compiled directly into
/// each debug session's dynamically-generated assembly alongside the user's instrumented code.
///
/// It is injected as source rather than referenced as a compiled assembly because a
/// Blazor-WASM-hosted assembly (this "engine" assembly itself) has no reliably readable
/// on-disk <see cref="System.Reflection.Assembly.Location"/> to hand to Roslyn as a
/// <c>MetadataReference</c>. Compiling it fresh into each debuggee assembly avoids that
/// entirely; the host side ("DebugWorkspace"/"DebugSession") talks to it purely via
/// reflection plus a JSON string handed back by <c>PollStateJson()</c>, so no compile-time
/// type identity needs to be shared across the assembly boundary.
/// </summary>
internal static class DebugRuntimeSource
{
    public const string Code = """
    namespace __DebugRuntime;

    using System;
    using System.Collections.Generic;
    using System.Text;
    using System.Text.Json;
    using System.Threading;

    public static class DebugHook
    {
        private sealed class Frame
        {
            public string MethodName { get; set; } = "";
            public string FileId { get; set; } = "";
            public int Line { get; set; }
            public int Column { get; set; }
            public Variable[] Locals { get; set; } = Array.Empty<Variable>();
        }

        private sealed class Variable
        {
            public string Name { get; set; } = "";
            public string Preview { get; set; } = "";
        }

        private sealed class StateDto
        {
            public string Status { get; set; } = "";
            public Frame[] CallStack { get; set; } = Array.Empty<Frame>();
            public string Output { get; set; } = "";
            public bool Success { get; set; }
            public string? ExceptionMessage { get; set; }
        }

        private static readonly object Sync = new();
        private static readonly ManualResetEventSlim ResumeSignal = new(false);
        private static readonly List<Frame> CallStack = new();
        private static readonly HashSet<string> Breakpoints = new(StringComparer.Ordinal);
        private static readonly StringBuilder Output = new();

        private static volatile string _mode = "Continue";
        private static int _stepTargetDepth;
        private static volatile bool _isPaused;
        private static volatile bool _isStopped;
        private static volatile bool _success = true;
        private static volatile string? _exceptionMessage;

        public static void SetBreakpoints(string fileId, int[] lines)
        {
            lock (Sync)
            {
                Breakpoints.RemoveWhere(key => key.StartsWith(fileId + "::", StringComparison.Ordinal));
                foreach (var line in lines)
                    Breakpoints.Add(fileId + "::" + line);
            }
        }

        public static void AppendOutput(string chunk)
        {
            lock (Sync) Output.Append(chunk);
        }

        public static void EnterMethod(string methodName, string fileId, int line)
        {
            lock (Sync)
            {
                CallStack.Add(new Frame { MethodName = methodName, FileId = fileId, Line = line, Column = 1 });
            }
        }

        public static void ExitMethod()
        {
            lock (Sync)
            {
                if (CallStack.Count > 0)
                    CallStack.RemoveAt(CallStack.Count - 1);
            }
        }

        public static void OnStep(string fileId, int line, int column, Func<(string Name, object? Value)[]> localsFactory)
        {
            if (_mode == "Aborting") throw new OperationCanceledException();

            bool shouldPause;
            lock (Sync)
            {
                if (CallStack.Count > 0)
                {
                    var top = CallStack[^1];
                    top.FileId = fileId;
                    top.Line = line;
                    top.Column = column;
                }

                var atBreakpoint = Breakpoints.Contains(fileId + "::" + line);
                shouldPause = atBreakpoint || _mode switch
                {
                    "StepInto" => true,
                    "StepOver" => CallStack.Count <= _stepTargetDepth,
                    "StepOut" => CallStack.Count < _stepTargetDepth,
                    _ => false,
                };
            }

            if (!shouldPause) return;

            (string Name, object? Value)[] localsRaw;
            try
            {
                localsRaw = localsFactory();
            }
            catch
            {
                localsRaw = Array.Empty<(string, object?)>();
            }

            lock (Sync)
            {
                if (CallStack.Count > 0)
                {
                    var variables = new Variable[localsRaw.Length];
                    for (var i = 0; i < localsRaw.Length; i++)
                        variables[i] = new Variable { Name = localsRaw[i].Name, Preview = FormatPreview(localsRaw[i].Value) };
                    CallStack[^1].Locals = variables;
                }
            }

            ResumeSignal.Reset();
            _isPaused = true;
            ResumeSignal.Wait();
            _isPaused = false;

            if (_mode == "Aborting") throw new OperationCanceledException();
        }

        public static void Resume(string mode)
        {
            lock (Sync) _stepTargetDepth = CallStack.Count;
            _mode = mode;
            ResumeSignal.Set();
        }

        public static void Abort()
        {
            _mode = "Aborting";
            ResumeSignal.Set();
        }

        public static void ReportFinished(bool success, string? exceptionMessage)
        {
            _isStopped = true;
            _success = success;
            _exceptionMessage = exceptionMessage;
        }

        public static string PollStateJson()
        {
            lock (Sync)
            {
                var status = _isStopped ? "stopped" : _isPaused ? "paused" : "running";
                var frames = CallStack.ToArray();
                Array.Reverse(frames);
                var dto = new StateDto
                {
                    Status = status,
                    CallStack = frames,
                    Output = Output.ToString(),
                    Success = _success,
                    ExceptionMessage = _exceptionMessage,
                };
                return JsonSerializer.Serialize(dto);
            }
        }

        private static string FormatPreview(object? value)
        {
            if (value is null) return "null";
            switch (value)
            {
                case string s:
                    return "\"" + s + "\"";
                case bool or byte or sbyte or short or ushort or int or uint or long or ulong or float or double or decimal or char:
                    return value.ToString() ?? "";
                default:
                    try
                    {
                        return value.GetType().Name + " " + (value.ToString() ?? "");
                    }
                    catch
                    {
                        return value.GetType().Name;
                    }
            }
        }
    }
    """;
}
