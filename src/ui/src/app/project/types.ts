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
  packages: InstalledPackageDto[]
}

export interface ProjectFileSnapshot {
  id: string
  name: string
  folders: string[]
  content: string
}

export interface PackageReferenceSnapshot {
  id: string
  version: string
}

export interface ProjectSnapshot {
  id: string
  name: string
  files: ProjectFileSnapshot[]
  emptyFolders: string[]
  packages: PackageReferenceSnapshot[]
}

export interface InstalledPackageDto {
  id: string
  version: string
  assemblyNames: string[]
  isDirect: boolean
}

export interface NuGetSearchResultDto {
  id: string
  version: string
  description: string | null
  iconUrl: string | null
  totalDownloads: number
  installed: boolean
}

export interface NuGetSearchResponseDto {
  results: NuGetSearchResultDto[]
  totalHits: number
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
