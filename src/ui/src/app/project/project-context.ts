import { createContext, useContext } from "react"
import type { ProjectDto, ProjectFileNode, RunResult } from "./types"

export interface OpenFile {
  id: string
  name: string
  content: string
}

export type ProjectStatus = "loading" | "empty" | "ready"

export interface ProjectContextValue {
  status: ProjectStatus
  project: ProjectDto | null
  openFiles: OpenFile[]
  activeFileId: string | null
  dirtyFileIds: ReadonlySet<string>
  createProject: (name: string) => Promise<void>
  openFile: (node: ProjectFileNode) => Promise<void>
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
  updateFileContent: (fileId: string, content: string) => void
  addFile: (parentPath: string | undefined, name: string) => Promise<void>
  addFolder: (parentPath: string | undefined, name: string) => Promise<void>
  renameEntry: (id: string, newName: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  runProject: () => Promise<RunResult>
}

export const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider")
  }
  return context
}
