export type ProjectFileKind = "file" | "folder"

export interface ProjectFileNode {
  id: string
  name: string
  kind: ProjectFileKind
  children?: ProjectFileNode[] | null
}

export interface ProjectDto {
  id: string
  name: string
  files: ProjectFileNode[]
}

export interface ProjectFileSnapshot {
  id: string
  name: string
  folders: string[]
  content: string
}

export interface ProjectSnapshot {
  id: string
  name: string
  files: ProjectFileSnapshot[]
  emptyFolders: string[]
}

export interface CompileDiagnostic {
  severity: string
  message: string
  fileId: string | null
  fileName: string | null
  line: number
  column: number
}

export interface CompileResult {
  success: boolean
  diagnostics: CompileDiagnostic[]
}

export interface RunResult {
  success: boolean
  diagnostics: CompileDiagnostic[]
  output: string
  exceptionMessage: string | null
}
