import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useDotNet } from "../../hooks/useDotNet"
import { useDebouncedCallback } from "../../hooks/useDebouncedCallback"
import { ensureBlazorReady } from "../blazor/blazorReady"
import {
  EditorActionsContext,
  EditorStateContext,
  ProjectContext,
  type ExplorerSelection,
  type FolderLinkStatus,
  type OpenFile,
  type PendingCreate,
  type ProjectStatus,
} from "./project-context"
import { clearSolutionSnapshot, loadSolutionSnapshot, saveSolutionSnapshot } from "./persistence"
import { setFileProjectRegistry } from "./fileProjectRegistry"
import { findFirstFile, flattenFiles } from "./treeUtils"
import {
  isFileSystemAccessSupported,
  pickWritableDirectory,
  readSolutionSnapshotFromDirectory,
  verifyReadWritePermission,
  writeSolutionSnapshotToDirectory,
} from "./diskSync"
import { clearLinkedFolderHandle, loadLinkedFolderHandle, saveLinkedFolderHandle } from "./folderLinkPersistence"
import type {
  CompileResult,
  NuGetSearchResponseDto,
  ProjectDto,
  ProjectFileNode,
  RunResult,
  SolutionDto,
  SolutionSnapshot,
} from "./types"

const SYNC_DEBOUNCE_MS = 500

interface EditorState {
  openFiles: OpenFile[]
  activeFileId: string | null
}

const EMPTY_EDITOR_STATE: EditorState = { openFiles: [], activeFileId: null }

function buildFileProjectMap(projects: ProjectDto[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const project of projects) {
    for (const fileId of flattenFiles(project.files).keys()) map.set(fileId, project.id)
  }
  return map
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { invoke } = useDotNet()
  const [status, setStatus] = useState<ProjectStatus>("loading")
  const [solution, setSolution] = useState<SolutionDto | null>(null)
  const [selectedProjectId, setSelectedProjectIdState] = useState<string | null>(null)
  const [explorerSelection, setExplorerSelectionState] = useState<ExplorerSelection | null>(null)
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null)
  const [editorState, setEditorState] = useState<EditorState>(EMPTY_EDITOR_STATE)
  const [dirtyFileIds, setDirtyFileIds] = useState<ReadonlySet<string>>(new Set())
  const [linkedFolderHandle, setLinkedFolderHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [folderLinkStatus, setFolderLinkStatus] = useState<FolderLinkStatus>(
    isFileSystemAccessSupported() ? "none" : "unsupported",
  )

  const editorStateRef = useRef(editorState)
  useEffect(() => {
    editorStateRef.current = editorState
  }, [editorState])

  // persistSnapshot reads this instead of taking a dependency on the state directly, so its own
  // identity (and every callback that depends on it) doesn't change every time the folder link does.
  const linkedFolderRef = useRef({ handle: linkedFolderHandle, status: folderLinkStatus })
  useEffect(() => {
    linkedFolderRef.current = { handle: linkedFolderHandle, status: folderLinkStatus }
  }, [linkedFolderHandle, folderLinkStatus])

  const applySolution = useCallback((next: SolutionDto) => {
    setSolution(next)
    setFileProjectRegistry(buildFileProjectMap(next.projects))
    setSelectedProjectIdState((prev) => (prev && next.projects.some((p) => p.id === prev) ? prev : next.startupProjectId))
    setExplorerSelectionState((prev) => (prev && next.projects.some((p) => p.id === prev.projectId) ? prev : null))
    setPendingCreate((prev) => (prev && next.projects.some((p) => p.id === prev.projectId) ? prev : null))

    const fileMap = new Map<string, ProjectFileNode>()
    for (const project of next.projects) for (const [id, node] of flattenFiles(project.files)) fileMap.set(id, node)

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

  const persistSnapshot = useCallback(async () => {
    const snapshot = await invoke<SolutionSnapshot>("GetSolutionSnapshot")
    await saveSolutionSnapshot(snapshot)

    const { handle, status } = linkedFolderRef.current
    if (handle && status === "linked") {
      try {
        await writeSolutionSnapshotToDirectory(handle, snapshot)
      } catch (error) {
        console.error("Failed to sync solution to its linked folder", error)
        setFolderLinkStatus("permission-needed")
      }
    }
  }, [invoke])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await ensureBlazorReady()
      const snapshot = await loadSolutionSnapshot()
      if (cancelled) return
      if (snapshot) {
        const hydrated = await invoke<SolutionDto>("HydrateSolution", snapshot)
        if (cancelled) return
        applySolution(hydrated)
        setStatus("ready")

        if (isFileSystemAccessSupported()) {
          const storedHandle = await loadLinkedFolderHandle()
          if (cancelled || !storedHandle) return
          const granted = await verifyReadWritePermission(storedHandle, false)
          if (cancelled) return
          setLinkedFolderHandle(storedHandle)
          setFolderLinkStatus(granted ? "linked" : "permission-needed")
        }
      } else {
        setStatus("empty")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoke, applySolution])

  const openFile = useCallback(
    async (projectId: string, node: ProjectFileNode) => {
      if (node.kind !== "file") return
      if (editorStateRef.current.openFiles.some((f) => f.id === node.id)) {
        setEditorState((prev) => ({ ...prev, activeFileId: node.id }))
        setSelectedProjectIdState(projectId)
        return
      }
      const content = await invoke<string>("GetFileContent", projectId, node.id)
      setEditorState((prev) =>
        prev.openFiles.some((f) => f.id === node.id)
          ? { ...prev, activeFileId: node.id }
          : {
              openFiles: [...prev.openFiles, { id: node.id, projectId, name: node.name, content }],
              activeFileId: node.id,
            },
      )
      setSelectedProjectIdState(projectId)
    },
    [invoke],
  )

  const createSolution = useCallback(
    async (name: string) => {
      const created = await invoke<SolutionDto>("CreateSolution", name)
      applySolution(created)
      setEditorState(EMPTY_EDITOR_STATE)
      setDirtyFileIds(new Set())
      setStatus("ready")
      await persistSnapshot()
      const firstProject = created.projects[0]
      const firstFile = firstProject ? findFirstFile(firstProject.files) : undefined
      if (firstProject && firstFile) await openFile(firstProject.id, firstFile)
    },
    [invoke, applySolution, persistSnapshot, openFile],
  )

  const closeSolution = useCallback(async () => {
    await clearSolutionSnapshot()
    await clearLinkedFolderHandle()
    setSolution(null)
    setFileProjectRegistry(new Map())
    setSelectedProjectIdState(null)
    setExplorerSelectionState(null)
    setPendingCreate(null)
    setEditorState(EMPTY_EDITOR_STATE)
    setDirtyFileIds(new Set())
    setLinkedFolderHandle(null)
    setFolderLinkStatus(isFileSystemAccessSupported() ? "none" : "unsupported")
    setStatus("empty")
  }, [])

  const newSolutionInFolder = useCallback(
    async (name: string) => {
      const handle = await pickWritableDirectory("zero-new-solution")
      if (!handle) return
      await createSolution(name)
      const snapshot = await invoke<SolutionSnapshot>("GetSolutionSnapshot")
      await writeSolutionSnapshotToDirectory(handle, snapshot)
      await saveLinkedFolderHandle(handle)
      setLinkedFolderHandle(handle)
      setFolderLinkStatus("linked")
    },
    [invoke, createSolution],
  )

  const openSolutionFromFolder = useCallback(async () => {
    const handle = await pickWritableDirectory("zero-open-solution")
    if (!handle) return

    let snapshot: SolutionSnapshot
    try {
      snapshot = await readSolutionSnapshotFromDirectory(handle, handle.name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
      return
    }

    const hydrated = await invoke<SolutionDto>("HydrateSolution", snapshot)
    applySolution(hydrated)
    setEditorState(EMPTY_EDITOR_STATE)
    setDirtyFileIds(new Set())
    setStatus("ready")

    await saveSolutionSnapshot(await invoke<SolutionSnapshot>("GetSolutionSnapshot"))
    await saveLinkedFolderHandle(handle)
    setLinkedFolderHandle(handle)
    setFolderLinkStatus("linked")

    const firstProject = hydrated.projects[0]
    const firstFile = firstProject ? findFirstFile(firstProject.files) : undefined
    if (firstProject && firstFile) await openFile(firstProject.id, firstFile)
  }, [invoke, applySolution, openFile])

  const reconnectFolder = useCallback(async () => {
    if (!linkedFolderHandle) return
    const granted = await verifyReadWritePermission(linkedFolderHandle, true)
    setFolderLinkStatus(granted ? "linked" : "permission-needed")
  }, [linkedFolderHandle])

  const unlinkFolder = useCallback(async () => {
    await clearLinkedFolderHandle()
    setLinkedFolderHandle(null)
    setFolderLinkStatus(isFileSystemAccessSupported() ? "none" : "unsupported")
  }, [])

  const addProject = useCallback(
    async (name: string) => {
      const updated = await invoke<SolutionDto>("AddProject", name)
      applySolution(updated)
      await persistSnapshot()
    },
    [invoke, applySolution, persistSnapshot],
  )

  const removeProject = useCallback(
    async (projectId: string) => {
      const updated = await invoke<SolutionDto>("RemoveProject", projectId)
      applySolution(updated)
      setEditorState((prev) => {
        const openFiles = prev.openFiles.filter((f) => f.projectId !== projectId)
        const activeFileId =
          prev.activeFileId && openFiles.some((f) => f.id === prev.activeFileId)
            ? prev.activeFileId
            : (openFiles[openFiles.length - 1]?.id ?? null)
        return { openFiles, activeFileId }
      })
      await persistSnapshot()
    },
    [invoke, applySolution, persistSnapshot],
  )

  const renameProject = useCallback(
    async (projectId: string, newName: string) => {
      const updated = await invoke<SolutionDto>("RenameProject", projectId, newName)
      applySolution(updated)
      await persistSnapshot()
    },
    [invoke, applySolution, persistSnapshot],
  )

  const setStartupProject = useCallback(
    async (projectId: string) => {
      const updated = await invoke<SolutionDto>("SetStartupProject", projectId)
      applySolution(updated)
      await persistSnapshot()
    },
    [invoke, applySolution, persistSnapshot],
  )

  const setSelectedProject = useCallback((projectId: string) => {
    setSelectedProjectIdState(projectId)
  }, [])

  const setExplorerSelection = useCallback((selection: ExplorerSelection | null) => {
    setExplorerSelectionState(selection)
  }, [])

  const startCreate = useCallback(
    (mode: "file" | "folder") => {
      const projectId = explorerSelection?.projectId ?? selectedProjectId ?? solution?.startupProjectId ?? solution?.projects[0]?.id
      if (!projectId) return
      const parentPath = explorerSelection?.projectId === projectId ? explorerSelection.parentPath : undefined
      setPendingCreate({ projectId, parentPath, mode })
    },
    [explorerSelection, selectedProjectId, solution],
  )

  const cancelCreate = useCallback(() => {
    setPendingCreate(null)
  }, [])

  const setProjectReferences = useCallback(
    async (projectId: string, referencedProjectIds: string[]) => {
      const updated = await invoke<SolutionDto>("SetProjectReferences", projectId, referencedProjectIds)
      applySolution(updated)
      await persistSnapshot()
    },
    [invoke, applySolution, persistSnapshot],
  )

  const exportSlnx = useCallback(async () => {
    const content = await invoke<string>("ExportSlnx")
    const blob = new Blob([content], { type: "application/xml" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${solution?.name ?? "Solution"}.slnx`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [invoke, solution])

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
    const projectId = editorStateRef.current.openFiles.find((f) => f.id === fileId)?.projectId
    if (projectId) setSelectedProjectIdState(projectId)
  }, [])

  const [debouncedSync, flushSync] = useDebouncedCallback(async (fileId: string, projectId: string, content: string) => {
    await invoke<void>("UpdateFileContent", projectId, fileId, content)
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
      const projectId = editorStateRef.current.openFiles.find((f) => f.id === fileId)?.projectId
      if (!projectId) return
      setEditorState((prev) => ({
        ...prev,
        openFiles: prev.openFiles.map((f) => (f.id === fileId ? { ...f, content } : f)),
      }))
      setDirtyFileIds((prev) => (prev.has(fileId) ? prev : new Set(prev).add(fileId)))
      debouncedSync(fileId, projectId, content)
    },
    [debouncedSync],
  )

  const applyProjectTree = useCallback(
    (projectId: string, files: ProjectFileNode[]) => {
      setSolution((prev) => {
        if (!prev) return prev
        const next = { ...prev, projects: prev.projects.map((p) => (p.id === projectId ? { ...p, files } : p)) }
        setFileProjectRegistry(buildFileProjectMap(next.projects))
        return next
      })
      const fileMap = flattenFiles(files)
      setEditorState((prev) => {
        const openFiles = prev.openFiles
          .filter((f) => f.projectId !== projectId || fileMap.has(f.id))
          .map((f) => {
            if (f.projectId !== projectId) return f
            const node = fileMap.get(f.id)!
            return node.name === f.name ? f : { ...f, name: node.name }
          })
        const activeFileId =
          prev.activeFileId && openFiles.some((f) => f.id === prev.activeFileId)
            ? prev.activeFileId
            : (openFiles[openFiles.length - 1]?.id ?? null)
        return { openFiles, activeFileId }
      })
    },
    [],
  )

  const addFile = useCallback(
    async (projectId: string, parentPath: string | undefined, name: string) => {
      const files = await invoke<ProjectFileNode[]>("AddFile", projectId, parentPath ?? null, name)
      applyProjectTree(projectId, files)
      await persistSnapshot()
    },
    [invoke, applyProjectTree, persistSnapshot],
  )

  const addFolder = useCallback(
    async (projectId: string, parentPath: string | undefined, name: string) => {
      const files = await invoke<ProjectFileNode[]>("AddFolder", projectId, parentPath ?? null, name)
      applyProjectTree(projectId, files)
      await persistSnapshot()
    },
    [invoke, applyProjectTree, persistSnapshot],
  )

  const renameEntry = useCallback(
    async (projectId: string, id: string, newName: string) => {
      const files = await invoke<ProjectFileNode[]>("RenameEntry", projectId, id, newName)
      applyProjectTree(projectId, files)
      await persistSnapshot()
    },
    [invoke, applyProjectTree, persistSnapshot],
  )

  const deleteEntry = useCallback(
    async (projectId: string, id: string) => {
      const files = await invoke<ProjectFileNode[]>("DeleteEntry", projectId, id)
      applyProjectTree(projectId, files)
      await persistSnapshot()
    },
    [invoke, applyProjectTree, persistSnapshot],
  )

  const exportZip = useCallback(async () => {
    await flushSync()
    // Blazor JS interop serializes a byte[] return value as a base64 string.
    const base64 = await invoke<string>("ExportZip")
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const blob = new Blob([bytes], { type: "application/zip" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${solution?.name ?? "Solution"}.zip`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [invoke, solution, flushSync])

  const compileProject = useCallback(
    async (projectId: string) => {
      await flushSync()
      return invoke<CompileResult>("Compile", projectId)
    },
    [invoke, flushSync],
  )

  const runProject = useCallback(
    async (projectId: string) => {
      await flushSync()
      return invoke<RunResult>("Run", projectId)
    },
    [invoke, flushSync],
  )

  const runStartupProject = useCallback(async () => {
    await flushSync()
    return invoke<RunResult>("Run", null)
  }, [invoke, flushSync])

  const cleanProject = useCallback(
    async (projectId: string) => {
      await invoke<void>("Clean", projectId)
    },
    [invoke],
  )

  const searchPackages = useCallback(
    (projectId: string, query: string, skip: number, take: number) =>
      invoke<NuGetSearchResponseDto>("SearchPackages", projectId, query, skip, take),
    [invoke],
  )

  // Installing/uninstalling a package rewrites the .csproj's <PackageReference> items on the
  // engine side. If that file happens to be open in an editor tab already, its in-memory content
  // was fetched before the rewrite and won't reflect it — refetch so the open tab stays in sync
  // instead of silently going stale until the user closes and reopens it.
  const refreshOpenCsprojTab = useCallback(
    async (projectId: string) => {
      const csprojFile = editorStateRef.current.openFiles.find((f) => f.projectId === projectId && f.name.endsWith(".csproj"))
      if (!csprojFile) return
      const content = await invoke<string>("GetFileContent", projectId, csprojFile.id)
      setEditorState((prev) => ({
        ...prev,
        openFiles: prev.openFiles.map((f) => (f.id === csprojFile.id ? { ...f, content } : f)),
      }))
    },
    [invoke],
  )

  const installPackage = useCallback(
    async (projectId: string, id: string, version?: string) => {
      const updatedProject = await invoke<ProjectDto>("InstallPackage", projectId, id, version ?? null)
      setSolution((prev) => (prev ? { ...prev, projects: prev.projects.map((p) => (p.id === projectId ? updatedProject : p)) } : prev))
      await refreshOpenCsprojTab(projectId)
      await persistSnapshot()
    },
    [invoke, persistSnapshot, refreshOpenCsprojTab],
  )

  const uninstallPackage = useCallback(
    async (projectId: string, id: string) => {
      const updatedProject = await invoke<ProjectDto>("UninstallPackage", projectId, id)
      setSolution((prev) => (prev ? { ...prev, projects: prev.projects.map((p) => (p.id === projectId ? updatedProject : p)) } : prev))
      await refreshOpenCsprojTab(projectId)
      await persistSnapshot()
    },
    [invoke, persistSnapshot, refreshOpenCsprojTab],
  )

  const value = useMemo(
    () => ({
      status,
      solutionName: solution?.name ?? null,
      projects: solution?.projects ?? [],
      projectReferences: solution?.projectReferences ?? {},
      startupProjectId: solution?.startupProjectId ?? null,
      selectedProjectId,
      explorerSelection,
      pendingCreate,
      folderLinkStatus,
      linkedFolderName: linkedFolderHandle?.name ?? null,
      createSolution,
      newSolutionInFolder,
      openSolutionFromFolder,
      reconnectFolder,
      unlinkFolder,
      closeSolution,
      addProject,
      removeProject,
      renameProject,
      setStartupProject,
      setSelectedProject,
      setExplorerSelection,
      startCreate,
      cancelCreate,
      setProjectReferences,
      exportSlnx,
      exportZip,
      addFile,
      addFolder,
      renameEntry,
      deleteEntry,
      compileProject,
      runStartupProject,
      runProject,
      cleanProject,
      searchPackages,
      installPackage,
      uninstallPackage,
    }),
    [
      status,
      solution,
      selectedProjectId,
      explorerSelection,
      pendingCreate,
      folderLinkStatus,
      linkedFolderHandle,
      createSolution,
      newSolutionInFolder,
      openSolutionFromFolder,
      reconnectFolder,
      unlinkFolder,
      closeSolution,
      addProject,
      removeProject,
      renameProject,
      setStartupProject,
      setSelectedProject,
      setExplorerSelection,
      startCreate,
      cancelCreate,
      setProjectReferences,
      exportSlnx,
      exportZip,
      addFile,
      addFolder,
      renameEntry,
      deleteEntry,
      compileProject,
      runStartupProject,
      runProject,
      cleanProject,
      searchPackages,
      installPackage,
      uninstallPackage,
    ],
  )

  // Open-tab state changes on every keystroke; kept in its own context so typing doesn't
  // re-render the explorer tree, title bar, status bar, search and NuGet panels.
  const editorStateValue = useMemo(
    () => ({
      openFiles: editorState.openFiles,
      activeFileId: editorState.activeFileId,
      dirtyFileIds,
    }),
    [editorState, dirtyFileIds],
  )

  // openFile/closeFile/setActiveFile/updateFileContent all read open-tab state from a ref rather
  // than closing over it, so this object is referentially stable and never triggers a re-render
  // on its own — safe for components that only need to dispatch an editor action.
  const editorActionsValue = useMemo(
    () => ({ openFile, closeFile, setActiveFile, updateFileContent }),
    [openFile, closeFile, setActiveFile, updateFileContent],
  )

  return (
    <ProjectContext.Provider value={value}>
      <EditorStateContext.Provider value={editorStateValue}>
        <EditorActionsContext.Provider value={editorActionsValue}>{children}</EditorActionsContext.Provider>
      </EditorStateContext.Provider>
    </ProjectContext.Provider>
  )
}
