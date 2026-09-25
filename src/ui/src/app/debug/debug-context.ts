import { createContext, useContext } from "react"

export interface VariableDto {
  name: string
  preview: string
}

export interface CallFrameDto {
  methodName: string
  fileId: string
  line: number
  column: number
  locals: VariableDto[]
}

export type DebugStatus = "idle" | "starting" | "running" | "paused" | "stopped"

export interface DebugContextValue {
  status: DebugStatus
  breakpoints: Record<string, number[]>
  callStack: CallFrameDto[]
  lastExceptionMessage: string | null
  toggleBreakpoint: (fileId: string, line: number) => void
  startDebug: (projectId?: string) => Promise<void>
  continue_: () => void
  stepOver: () => void
  stepInto: () => void
  stepOut: () => void
  stop: () => void
}

export const DebugContext = createContext<DebugContextValue | undefined>(undefined)

export function useDebug(): DebugContextValue {
  const context = useContext(DebugContext)
  if (!context) {
    throw new Error("useDebug must be used within a DebugProvider")
  }
  return context
}
