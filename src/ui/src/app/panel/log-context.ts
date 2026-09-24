import { createContext, useContext } from "react"

export type LogChannel = "output" | "debug"

export interface LogLine {
  id: string
  channel: LogChannel
  text: string
  timestamp: number
}

export interface LogContextValue {
  lines: LogLine[]
  appendLine: (channel: LogChannel, text: string) => void
  clear: (channel?: LogChannel) => void
}

export const LogContext = createContext<LogContextValue | undefined>(undefined)

export function useLog(): LogContextValue {
  const context = useContext(LogContext)
  if (!context) {
    throw new Error("useLog must be used within a LogProvider")
  }
  return context
}
