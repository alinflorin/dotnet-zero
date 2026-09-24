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
