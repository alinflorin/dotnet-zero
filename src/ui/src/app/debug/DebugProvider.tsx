import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useDotNet } from "../../hooks/useDotNet"
import { ensureBlazorReady } from "../blazor/blazorReady"
import { useLog } from "../panel/log-context"
import { DebugContext, type CallFrameDto, type DebugStatus } from "./debug-context"

interface DebugStateDto {
  status: DebugStatus
  callStack: CallFrameDto[]
  output: string
  success: boolean
  exceptionMessage: string | null
}

const POLL_INTERVAL_MS = 120

export function DebugProvider({ children }: { children: ReactNode }) {
  const { invoke } = useDotNet()
  const { appendLine } = useLog()
  const [status, setStatus] = useState<DebugStatus>("idle")
  const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({})
  const [callStack, setCallStack] = useState<CallFrameDto[]>([])
  const [lastExceptionMessage, setLastExceptionMessage] = useState<string | null>(null)

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const outputLengthRef = useRef(0)

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const applyState = useCallback(
    (state: DebugStateDto) => {
      setStatus(state.status)
      setCallStack(state.callStack)
      if (state.output.length > outputLengthRef.current) {
        appendLine("debug", state.output.slice(outputLengthRef.current))
        outputLengthRef.current = state.output.length
      }
      if (state.status === "stopped") {
        if (state.exceptionMessage) appendLine("debug", state.exceptionMessage)
        setLastExceptionMessage(state.exceptionMessage)
      }
    },
    [appendLine],
  )

  const pollRef = useRef<() => Promise<void>>(async () => {})
  const poll = useCallback(async () => {
    const state = await invoke<DebugStateDto>("Poll")
    applyState(state)
    if (state.status === "running" || state.status === "starting") {
      pollTimerRef.current = setTimeout(() => void pollRef.current(), POLL_INTERVAL_MS)
    }
  }, [invoke, applyState])
  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  const startDebug = useCallback(async () => {
    stopPolling()
    outputLengthRef.current = 0
    setLastExceptionMessage(null)
    setCallStack([])
    setStatus("starting")
    appendLine("debug", "Starting debug session…")

    await ensureBlazorReady()
    const result = await invoke<{ success: boolean; diagnostics: { severity: string; message: string; line: number; column: number }[] }>(
      "StartDebug",
    )

    if (!result.success) {
      for (const diagnostic of result.diagnostics) {
        appendLine("debug", `(${diagnostic.line},${diagnostic.column}): ${diagnostic.severity}: ${diagnostic.message}`)
      }
      setStatus("stopped")
      return
    }

    void poll()
  }, [invoke, appendLine, stopPolling, poll])

  const resumeWith = useCallback(
    (method: string) => {
      void (async () => {
        await invoke<void>(method)
        setStatus("running")
        void poll()
      })()
    },
    [invoke, poll],
  )

  const continue_ = useCallback(() => resumeWith("Continue"), [resumeWith])
  const stepOver = useCallback(() => resumeWith("StepOver"), [resumeWith])
  const stepInto = useCallback(() => resumeWith("StepInto"), [resumeWith])
  const stepOut = useCallback(() => resumeWith("StepOut"), [resumeWith])

  const stop = useCallback(() => {
    stopPolling()
    void invoke<void>("Stop")
    setStatus("idle")
    setCallStack([])
  }, [invoke, stopPolling])

  const toggleBreakpoint = useCallback(
    (fileId: string, line: number) => {
      setBreakpoints((prev) => {
        const existing = prev[fileId] ?? []
        const next = existing.includes(line) ? existing.filter((l) => l !== line) : [...existing, line].sort((a, b) => a - b)
        void invoke<void>("SetBreakpoints", fileId, next)
        return { ...prev, [fileId]: next }
      })
    },
    [invoke],
  )

  const value = useMemo(
    () => ({
      status,
      breakpoints,
      callStack,
      lastExceptionMessage,
      toggleBreakpoint,
      startDebug,
      continue_,
      stepOver,
      stepInto,
      stepOut,
      stop,
    }),
    [status, breakpoints, callStack, lastExceptionMessage, toggleBreakpoint, startDebug, continue_, stepOver, stepInto, stepOut, stop],
  )

  return <DebugContext.Provider value={value}>{children}</DebugContext.Provider>
}
