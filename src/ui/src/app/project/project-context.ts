import { createContext, useContext } from "react"
import type {
  CompileResult,
  NuGetSearchResponseDto,
  ProjectDto,
  ProjectFileNode,
  ProjectReferenceGraph,
  RunResult,
} from "./types"

export interface OpenFile {
  id: string
  projectId: string
  name: string
  content: string
}

export type ProjectStatus = "loading" | "empty" | "ready"

export interface ProjectContextValue {
  status: ProjectStatus
  solutionName: string | null
  projects: ProjectDto[]
  projectReferences: ProjectReferenceGraph
  startupProjectId: string | null
  selectedProjectId: string | null
  openFiles: OpenFile[]
  activeFileId: string | null
  dirtyFileIds: ReadonlySet<string>
  createSolution: (name: string) => Promise<void>
  addProject: (name: string) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  renameProject: (projectId: string, newName: string) => Promise<void>
  setStartupProject: (projectId: string) => Promise<void>
  setSelectedProject: (projectId: string) => void
  setProjectReferences: (projectId: string, referencedProjectIds: string[]) => Promise<void>
  exportSlnx: () => Promise<void>
  openFile: (projectId: string, node: ProjectFileNode) => Promise<void>
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
  updateFileContent: (fileId: string, content: string) => void
  addFile: (projectId: string, parentPath: string | undefined, name: string) => Promise<void>
  addFolder: (projectId: string, parentPath: string | undefined, name: string) => Promise<void>
  renameEntry: (projectId: string, id: string, newName: string) => Promise<void>
  deleteEntry: (projectId: string, id: string) => Promise<void>
  compileProject: (projectId: string) => Promise<CompileResult>
  runStartupProject: () => Promise<RunResult>
  runProject: (projectId: string) => Promise<RunResult>
  cleanProject: (projectId: string) => Promise<void>
  searchPackages: (projectId: string, query: string, skip: number, take: number) => Promise<NuGetSearchResponseDto>
  installPackage: (projectId: string, id: string, version?: string) => Promise<void>
  uninstallPackage: (projectId: string, id: string) => Promise<void>
}

export const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider")
  }
  return context
}
