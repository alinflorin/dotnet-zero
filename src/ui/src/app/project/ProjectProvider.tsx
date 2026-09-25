import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useDotNet } from "../../hooks/useDotNet"
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback"
import { ensureBlazorReady } from "../blazor/blazorReady"
import { ProjectContext, type OpenFile, type ProjectStatus } from "./project-context"
import { loadProjectSnapshot, saveProjectSnapshot } from "./persistence"
import { findFirstFile, flattenFiles } from "./treeUtils"
import type {
  CompileResult,
  NuGetSearchResponseDto,
  ProjectDto,
  ProjectFileNode,
  ProjectSnapshot,
  RunResult,
} from "./types"

const SYNC_DEBOUNCE_MS = 500

interface EditorState {
  openFiles: OpenFile[]
  activeFileId: string | null
}

const EMPTY_EDITOR_STATE: EditorState = { openFiles: [], activeFileId: null }

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { invoke } = useDotNet()
  const [status, setStatus] = useState<ProjectStatus>("loading")
  const [project, setProject] = useState<ProjectDto | null>(null)
  const [editorState, setEditorState] = useState<EditorState>(EMPTY_EDITOR_STATE)
  const [dirtyFileIds, setDirtyFileIds] = useState<ReadonlySet<string>>(new Set())

  const editorStateRef = useRef(editorState)
  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  const persistSnapshot = useCallback(async () => {
    const snapshot = await invoke<ProjectSnapshot>("GetSnapshot")
    await saveProjectSnapshot(snapshot)
  }, [invoke])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureBlazorReady()
      const snapshot = await loadProjectSnapshot()
      if (cancelled) return
      if (snapshot) {
        const hydrated = await invoke<ProjectDto>("HydrateProject", snapshot)
        if (cancelled) return
        setProject(hydrated)
        setStatus("ready")
      } else {
        setStatus("empty")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoke])

  const applyTree = useCallback((files: ProjectFileNode[]) => {
    setProject((prev) => (prev ? { ...prev, files } : prev))
    const fileMap = flattenFiles(files)
    setEditorState((prev) => {
      const openFiles = prev.openFiles
        .filter((f) => fileMap.has(f.id))
        .map((f) => {
          const node = fileMap.get(f.id)!
          return node.name === f.name ? f : { ...f, name: node.name }
        })
      const activeFileId =
        prev.activeFileId && openFiles.some((f) => f.id === prev.activeFileId)
          ? prev.activeFileId
          : (openFiles[openFiles.length - 1]?.id ?? null)
      return { openFiles, activeFileId }
    })
  }, [])

  const openFile = useCallback(
    async (node: ProjectFileNode) => {
      if (node.kind !== "file") return
      if (editorStateRef.current.openFiles.some((f) => f.id === node.id)) {
        setEditorState((prev) => ({ ...prev, activeFileId: node.id }))
        return
      }
      const content = await invoke<string>("GetFileContent", node.id)
      setEditorState((prev) =>
        prev.openFiles.some((f) => f.id === node.id)
          ? { ...prev, activeFileId: node.id }
          : { openFiles: [...prev.openFiles, { id: node.id, name: node.name, content }], activeFileId: node.id },
      )
    },
    [invoke],
  )

  const createProject = useCallback(
    async (name: string) => {
      const created = await invoke<ProjectDto>("CreateProject", name)
      setProject(created)
      setEditorState(EMPTY_EDITOR_STATE)
      setDirtyFileIds(new Set())
      setStatus("ready")
      await persistSnapshot()
      const firstFile = findFirstFile(created.files)
      if (firstFile) await openFile(firstFile)
    },
    [invoke, persistSnapshot, openFile],
  )

  const closeFile = useCallback((fileId: string) => {
    setEditorState((prev) => {
      const openFiles = prev.openFiles.filter((f) => f.id !== fileId)
      const activeFileId =
        prev.activeFileId === fileId ? (openFiles[openFiles.length - 1]?.id ?? null) : prev.activeFileId
      return { openFiles, activeFileId }
    })
  }, [])

  const setActiveFile = useCallback((fileId: string) => {
    setEditorState((prev) => ({ ...prev, activeFileId: fileId }))
  }, [])

  const [debouncedSync, flushSync] = useDebouncedCallback(async (fileId: string, content: string) => {
    await invoke<void>("UpdateFileContent", fileId, content)
    await persistSnapshot()
    setDirtyFileIds((prev) => {
      if (!prev.has(fileId)) return prev
      const next = new Set(prev)
      next.delete(fileId)
      return next
    })
  }, SYNC_DEBOUNCE_MS)

  const updateFileContent = useCallback(
    (fileId: string, content: string) => {
      setEditorState((prev) => ({
        ...prev,
        openFiles: prev.openFiles.map((f) => (f.id === fileId ? { ...f, content } : f)),
      }))
      setDirtyFileIds((prev) => (prev.has(fileId) ? prev : new Set(prev).add(fileId)))
      debouncedSync(fileId, content)
    },
    [debouncedSync],
  )

  const addFile = useCallback(
    async (parentPath: string | undefined, name: string) => {
      const files = await invoke<ProjectFileNode[]>("AddFile", parentPath ?? null, name)
      applyTree(files)
      await persistSnapshot()
    },
    [invoke, applyTree, persistSnapshot],
  )

  const addFolder = useCallback(
    async (parentPath: string | undefined, name: string) => {
      const files = await invoke<ProjectFileNode[]>("AddFolder", parentPath ?? null, name)
      applyTree(files)
      await persistSnapshot()
    },
    [invoke, applyTree, persistSnapshot],
  )

  const renameEntry = useCallback(
    async (id: string, newName: string) => {
      const files = await invoke<ProjectFileNode[]>("RenameEntry", id, newName)
      applyTree(files)
      await persistSnapshot()
    },
    [invoke, applyTree, persistSnapshot],
  )

  const deleteEntry = useCallback(
    async (id: string) => {
      const files = await invoke<ProjectFileNode[]>("DeleteEntry", id)
      applyTree(files)
      await persistSnapshot()
    },
    [invoke, applyTree, persistSnapshot],
  )

  const compileProject = useCallback(async () => {
    await flushSync()
    return invoke<CompileResult>("Compile")
  }, [invoke, flushSync])

  const runProject = useCallback(async () => {
    await flushSync()
    return invoke<RunResult>("Run")
  }, [invoke, flushSync])

  const cleanProject = useCallback(async () => {
    await invoke<void>("Clean")
  }, [invoke])

  const searchPackages = useCallback(
    (query: string, skip: number, take: number) => invoke<NuGetSearchResponseDto>("SearchPackages", query, skip, take),
    [invoke],
  )

  // Installing/uninstalling a package rewrites the .csproj's <PackageReference> items on the
  // engine side. If that file happens to be open in an editor tab already, its in-memory content
  // was fetched before the rewrite and won't reflect it — refetch so the open tab stays in sync
  // instead of silently going stale until the user closes and reopens it.
  const refreshOpenCsprojTab = useCallback(async () => {
    const csprojFile = editorStateRef.current.openFiles.find((f) => f.name.endsWith(".csproj"))
    if (!csprojFile) return
    const content = await invoke<string>("GetFileContent", csprojFile.id)
    setEditorState((prev) => ({
      ...prev,
      openFiles: prev.openFiles.map((f) => (f.id === csprojFile.id ? { ...f, content } : f)),
    }))
  }, [invoke])

  const installPackage = useCallback(
    async (id: string, version?: string) => {
      const updated = await invoke<ProjectDto>("InstallPackage", id, version ?? null)
      setProject(updated)
      await refreshOpenCsprojTab()
      await persistSnapshot()
    },
    [invoke, persistSnapshot, refreshOpenCsprojTab],
  )

  const uninstallPackage = useCallback(
    async (id: string) => {
      const updated = await invoke<ProjectDto>("UninstallPackage", id)
      setProject(updated)
      await refreshOpenCsprojTab()
      await persistSnapshot()
    },
    [invoke, persistSnapshot, refreshOpenCsprojTab],
  )

  const value = useMemo(
    () => ({
      status,
      project,
      openFiles: editorState.openFiles,
      activeFileId: editorState.activeFileId,
      dirtyFileIds,
      createProject,
      openFile,
      closeFile,
      setActiveFile,
      updateFileContent,
      addFile,
      addFolder,
      renameEntry,
      deleteEntry,
      compileProject,
      runProject,
      cleanProject,
      searchPackages,
      installPackage,
      uninstallPackage,
    }),
    [
      status,
      project,
      editorState,
      dirtyFileIds,
      createProject,
      openFile,
      closeFile,
      setActiveFile,
      updateFileContent,
      addFile,
      addFolder,
      renameEntry,
      deleteEntry,
      compileProject,
      runProject,
      cleanProject,
      searchPackages,
      installPackage,
      uninstallPackage,
    ],
  )

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}
