import { createContext, useContext } from "react"
import type {
  CompileResult,
  NuGetSearchResponseDto,
  ProjectDto,
  ProjectFileNode,
  ProjectReferenceGraph,
  ProjectType,
  RunResult,
} from "./types"

export interface OpenFile {
  id: string
  projectId: string
  name: string
  content: string
}

export type ProjectStatus = "loading" | "empty" | "ready"

/** Whether the current solution is mirrored to a folder on disk via the File System Access API.
 * "unsupported": the browser has no File System Access API (Safari/Firefox) — disk linking is hidden.
 * "none": supported, but the current solution isn't linked to a folder.
 * "linked": actively mirroring every save to the linked folder.
 * "permission-needed": a linked folder was restored from a previous session but needs the user to
 * re-grant write permission (browsers require a user gesture for this, so it can't happen automatically). */
export type FolderLinkStatus = "unsupported" | "none" | "linked" | "permission-needed"

export interface ExplorerSelection {
  projectId: string
  /** Id of the selected file/folder entry, or null when the project root itself is selected. */
  entryId: string | null
  /** Where a newly created file/folder should be placed given this selection. */
  parentPath: string | undefined
}

export interface PendingCreate {
  projectId: string
  parentPath: string | undefined
  mode: "file" | "folder"
}

export interface ProjectContextValue {
  status: ProjectStatus
  solutionName: string | null
  projects: ProjectDto[]
  projectReferences: ProjectReferenceGraph
  startupProjectId: string | null
  selectedProjectId: string | null
  explorerSelection: ExplorerSelection | null
  pendingCreate: PendingCreate | null
  folderLinkStatus: FolderLinkStatus
  linkedFolderName: string | null
  createSolution: (name: string, projectType?: ProjectType) => Promise<void>
  newSolutionInFolder: (name: string, projectType?: ProjectType) => Promise<void>
  openSolutionFromFolder: () => Promise<void>
  reconnectFolder: () => Promise<void>
  unlinkFolder: () => Promise<void>
  closeSolution: () => Promise<void>
  addProject: (name: string, projectType?: ProjectType) => Promise<void>
  removeProject: (projectId: string) => Promise<void>
  renameProject: (projectId: string, newName: string) => Promise<void>
  setStartupProject: (projectId: string) => Promise<void>
  setSelectedProject: (projectId: string) => void
  setExplorerSelection: (selection: ExplorerSelection | null) => void
  startCreate: (mode: "file" | "folder") => void
  cancelCreate: () => void
  setProjectReferences: (projectId: string, referencedProjectIds: string[]) => Promise<void>
  exportZip: () => Promise<void>
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

/** Open-tab state: changes on every keystroke in the editor. Kept out of ProjectContextValue so
 * that typing doesn't re-render the explorer tree, title bar, status bar, search and NuGet panels. */
export interface EditorStateContextValue {
  openFiles: OpenFile[]
  activeFileId: string | null
  dirtyFileIds: ReadonlySet<string>
}

/** Editor actions. These callbacks are referentially stable across renders (they read the latest
 * open-tab state from a ref rather than closing over it), so consuming this context alone never
 * causes a re-render — safe to use from components like the explorer tree that only need to
 * trigger `openFile` without caring about open-tab state itself. */
export interface EditorActionsContextValue {
  openFile: (projectId: string, node: ProjectFileNode) => Promise<void>
  closeFile: (fileId: string) => void
  setActiveFile: (fileId: string) => void
  updateFileContent: (fileId: string, content: string) => void
}

export const ProjectContext = createContext<ProjectContextValue | undefined>(undefined)
export const EditorStateContext = createContext<EditorStateContextValue | undefined>(undefined)
export const EditorActionsContext = createContext<EditorActionsContextValue | undefined>(undefined)

export function useProject(): ProjectContextValue {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error("useProject must be used within a ProjectProvider")
  }
  return context
}

export function useEditorState(): EditorStateContextValue {
  const context = useContext(EditorStateContext)
  if (!context) {
    throw new Error("useEditorState must be used within a ProjectProvider")
  }
  return context
}

export function useEditorActions(): EditorActionsContextValue {
  const context = useContext(EditorActionsContext)
  if (!context) {
    throw new Error("useEditorActions must be used within a ProjectProvider")
  }
  return context
}
