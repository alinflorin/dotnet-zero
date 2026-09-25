import type { ProjectFileSnapshot, ProjectReferenceGraph, ProjectSnapshot, SolutionSnapshot } from "./types"

const SKIP_DIR_NAMES = new Set(["bin", "obj", "node_modules", ".git", ".vs", ".vscode", ".idea"])
const SKIP_FILE_NAMES = new Set([".DS_Store"])

function newId(): string {
  return crypto.randomUUID().replace(/-/g, "")
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
}

/** Opens the native directory picker with read/write access. Returns null if the user cancels. */
export async function pickWritableDirectory(id: string): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null
  try {
    return await window.showDirectoryPicker({ id, mode: "readwrite" })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null
    throw error
  }
}

/** Checks (and optionally prompts for) read/write permission on a previously-granted handle.
 * Requesting permission requires an active user gesture, so callers doing this on page load
 * (no gesture) should pass `requestIfNeeded: false` and prompt the user to reconnect instead. */
export async function verifyReadWritePermission(handle: FileSystemDirectoryHandle, requestIfNeeded: boolean): Promise<boolean> {
  const descriptor = { mode: "readwrite" as const }
  if ((await handle.queryPermission(descriptor)) === "granted") return true
  if (!requestIfNeeded) return false
  return (await handle.requestPermission(descriptor)) === "granted"
}

async function ensureDir(root: FileSystemDirectoryHandle, segments: readonly string[]): Promise<FileSystemDirectoryHandle> {
  let dir = root
  for (const segment of segments) dir = await dir.getDirectoryHandle(segment, { create: true })
  return dir
}

async function writeTextFile(dir: FileSystemDirectoryHandle, name: string, content: string): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(content)
  await writable.close()
}

async function clearDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = []
  for await (const name of dir.keys()) names.push(name)
  await Promise.all(names.map((name) => dir.removeEntry(name, { recursive: true })))
}

function buildSlnx(snapshot: SolutionSnapshot): string {
  const projects = snapshot.projects.map((p) => `  <Project Path="${p.name}/${p.name}.csproj" />`).join("\n")
  return `<?xml version="1.0" encoding="utf-8"?>\n<Solution>\n${projects}\n</Solution>\n`
}

/// Mirrors the given solution snapshot onto disk: one subfolder per project, each fully replaced
/// (not diffed) so renamed/deleted files never linger. This is a one-way, browser-to-disk mirror,
/// not a live two-way sync — it runs after every mutation alongside the existing IndexedDB save.
export async function writeSolutionSnapshotToDirectory(root: FileSystemDirectoryHandle, snapshot: SolutionSnapshot): Promise<void> {
  await writeTextFile(root, `${snapshot.name}.slnx`, buildSlnx(snapshot))

  for (const project of snapshot.projects) {
    const projectDir = await root.getDirectoryHandle(project.name, { create: true })
    await clearDirectory(projectDir)

    for (const folder of project.emptyFolders) await ensureDir(projectDir, folder.split("/").filter(Boolean))

    for (const file of project.files) {
      const dir = file.folders.length === 0 ? projectDir : await ensureDir(projectDir, file.folders)
      await writeTextFile(dir, file.name, file.content)
    }
  }
}

async function walkProjectDir(
  dir: FileSystemDirectoryHandle,
  folders: readonly string[],
  files: ProjectFileSnapshot[],
  emptyFolders: string[],
): Promise<void> {
  let hasEntry = false
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file") {
      if (SKIP_FILE_NAMES.has(name)) continue
      hasEntry = true
      const content = await (await handle.getFile()).text()
      files.push({ id: newId(), name, folders: [...folders], content })
    } else {
      if (SKIP_DIR_NAMES.has(name)) continue
      hasEntry = true
      await walkProjectDir(handle, [...folders, name], files, emptyFolders)
    }
  }
  if (!hasEntry && folders.length > 0) emptyFolders.push(folders.join("/"))
}

async function containsCsproj(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === "file" && name.toLowerCase().endsWith(".csproj")) return true
  }
  return false
}

/// Parses each project's .csproj for <ProjectReference Include="../Other/Other.csproj" /> entries
/// and resolves them to sibling project ids by folder name, since a raw disk import has no id-based
/// reference graph the way the app's own IndexedDB snapshot does.
function resolveProjectReferences(projects: ProjectSnapshot[]): ProjectReferenceGraph {
  const nameToId = new Map(projects.map((p) => [p.name, p.id]))
  const graph: ProjectReferenceGraph = {}

  for (const project of projects) {
    const csproj = project.files.find((f) => f.folders.length === 0 && f.name.toLowerCase().endsWith(".csproj"))
    const refs = new Set<string>()
    if (csproj) {
      for (const match of csproj.content.matchAll(/<ProjectReference\s+[^>]*Include="([^"]+)"/gi)) {
        const segments = match[1].replace(/\\/g, "/").split("/").filter(Boolean)
        const projectFolder = segments.length >= 2 ? segments[segments.length - 2] : undefined
        const refId = projectFolder ? nameToId.get(projectFolder) : undefined
        if (refId) refs.add(refId)
      }
    }
    graph[project.id] = [...refs]
  }

  return graph
}

/// Imports a folder tree as a solution: every top-level subfolder that directly contains a
/// .csproj becomes a project. This is a one-time read into the browser's in-memory/IndexedDB
/// model, not a live link — call writeSolutionSnapshotToDirectory afterwards (and on every
/// subsequent save) to keep mirroring changes back to this same folder.
export async function readSolutionSnapshotFromDirectory(root: FileSystemDirectoryHandle, fallbackName: string): Promise<SolutionSnapshot> {
  const projects: ProjectSnapshot[] = []

  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== "directory" || SKIP_DIR_NAMES.has(name)) continue
    if (!(await containsCsproj(handle))) continue

    const files: ProjectFileSnapshot[] = []
    const emptyFolders: string[] = []
    await walkProjectDir(handle, [], files, emptyFolders)
    projects.push({ id: newId(), name, files, emptyFolders })
  }

  if (projects.length === 0) {
    throw new Error("No project folders (containing a .csproj) were found in the selected directory.")
  }

  return {
    id: newId(),
    name: fallbackName,
    projects,
    projectReferences: resolveProjectReferences(projects),
    startupProjectId: projects[0].id,
  }
}
