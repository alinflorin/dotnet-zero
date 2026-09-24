import { useCallback, useMemo, useState, type ReactNode } from "react"
import { LogContext, type LogChannel, type LogLine } from "./log-context"

const MAX_LINES = 2000

export function LogProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<LogLine[]>([])

  const appendLine = useCallback((channel: LogChannel, text: string) => {
    setLines((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), channel, text, timestamp: Date.now() }]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  const clear = useCallback((channel?: LogChannel) => {
    setLines((prev) => (channel ? prev.filter((line) => line.channel !== channel) : []))
  }, [])

  const value = useMemo(() => ({ lines, appendLine, clear }), [lines, appendLine, clear])

  return <LogContext.Provider value={value}>{children}</LogContext.Provider>
}
