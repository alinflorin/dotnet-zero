import { useCallback, useEffect, useState } from "react"
import { makeStyles, tokens, mergeClasses } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { TitleBar } from "./TitleBar"
import { ActivityBar, type ActivityView } from "./ActivityBar"
import { SideBar } from "./SideBar"
import { StatusBar } from "./StatusBar"
import { EditorArea } from "../editor/EditorArea"
import { Panel } from "../panel/Panel"
import { useResizablePane } from "../../hooks/useResizablePane"
import { useProject } from "../../app/project/project-context"
import { useLog } from "../../app/panel/log-context"
import { useDebug } from "../../app/debug/debug-context"
import type { RunResult } from "../../app/project/types"

const MOBILE_QUERY = "(max-width: 768px)"
const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480
const DEFAULT_PANEL_HEIGHT = 220
const MIN_PANEL_HEIGHT = 120
const MAX_PANEL_HEIGHT = 640

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  main: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minHeight: 0,
  },
  workbench: {
    display: "flex",
    flexGrow: 1,
    minHeight: 0,
    position: "relative",
  },
  sidebarOverlay: {
    position: "fixed",
    inset: 0,
    top: "36px",
    backgroundColor: tokens.colorBackgroundOverlay,
    zIndex: 10,
  },
  sidebarMobile: {
    position: "fixed",
    top: "36px",
    bottom: "22px",
    left: "48px",
    zIndex: 11,
    boxShadow: tokens.shadow16,
  },
  resizing: {
    userSelect: "none",
  },
})

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  return isMobile
}

export function Shell() {
  const styles = useStyles()
  const { t } = useTranslation()
  const {
    compileProject,
    runStartupProject,
    cleanProject,
    selectedProjectId,
    startupProjectId,
    addProject,
    createSolution,
    newSolutionInFolder,
    openSolutionFromFolder,
  } = useProject()
  const targetProjectId = selectedProjectId ?? startupProjectId
  const { appendLine, clear, panelOpen, showChannel, togglePanel } = useLog()
  const { startDebug } = useDebug()
  const [activeView, setActiveView] = useState<ActivityView>("explorer")
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const handleCompile = useCallback(async () => {
    if (isBusy || !targetProjectId) return
    setIsBusy(true)
    showChannel("output")
    clear("output")
    appendLine("output", t("run.compiling"))
    try {
      const result = await compileProject(targetProjectId)
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.fileName ? `${diagnostic.fileName}(${diagnostic.line},${diagnostic.column}): ` : ""
        appendLine("output", `${location}${diagnostic.severity}: ${diagnostic.message}`)
      }
      appendLine("output", result.success ? t("run.succeeded") : t("run.failed"))
    } catch (error) {
      appendLine("output", String(error))
    } finally {
      setIsBusy(false)
    }
  }, [isBusy, targetProjectId, compileProject, appendLine, clear, showChannel, t])

  const reportRunResult = useCallback(
    (result: RunResult) => {
      for (const diagnostic of result.diagnostics) {
        const location = diagnostic.fileName ? `${diagnostic.fileName}(${diagnostic.line},${diagnostic.column}): ` : ""
        appendLine("output", `${location}${diagnostic.severity}: ${diagnostic.message}`)
      }
      if (!result.success) {
        appendLine("output", t("run.failed"))
      } else {
        for (const line of result.output.split("\n")) {
          if (line.length > 0) appendLine("output", line)
        }
        if (result.exceptionMessage) appendLine("output", result.exceptionMessage)
        appendLine("output", t("run.finished"))
      }
    },
    [appendLine, t],
  )

  const handleRun = useCallback(async () => {
    if (isBusy) return
    setIsBusy(true)
    showChannel("output")
    clear("output")
    appendLine("output", t("run.compiling"))
    try {
      reportRunResult(await runStartupProject())
    } catch (error) {
      appendLine("output", String(error))
    } finally {
      setIsBusy(false)
    }
  }, [isBusy, runStartupProject, reportRunResult, appendLine, clear, showChannel, t])

  const handleDebug = useCallback(async () => {
    if (isBusy) return
    setActiveView("debug")
    showChannel("debug")
    clear("debug")
    try {
      await startDebug()
    } catch (error) {
      appendLine("debug", String(error))
    }
  }, [isBusy, startDebug, appendLine, clear, showChannel])

  const handleClean = useCallback(async () => {
    if (isBusy || !targetProjectId) return
    await cleanProject(targetProjectId)
    showChannel("output")
    appendLine("output", t("run.cleaned"))
  }, [isBusy, targetProjectId, cleanProject, appendLine, showChannel, t])

  const handleNewProject = useCallback(() => {
    const name = window.prompt(t("sidebar.projectNamePlaceholder"))
    if (name?.trim()) void addProject(name.trim())
  }, [addProject, t])

  const handleNewSolution = useCallback(() => {
    const name = window.prompt(t("solution.newSolutionNamePlaceholder"))
    if (name?.trim()) void createSolution(name.trim())
  }, [createSolution, t])

  const handleNewSolutionInFolder = useCallback(() => {
    const name = window.prompt(t("solution.newSolutionNamePlaceholder"))
    if (name?.trim()) void newSolutionInFolder(name.trim())
  }, [newSolutionInFolder, t])

  const handleOpenSolutionFromFolder = useCallback(() => {
    void openSolutionFromFolder()
  }, [openSolutionFromFolder])

  const sidebarPane = useResizablePane({
    axis: "horizontal",
    initialSize: DEFAULT_SIDEBAR_WIDTH,
    min: MIN_SIDEBAR_WIDTH,
    max: MAX_SIDEBAR_WIDTH,
  })

  const panelPane = useResizablePane({
    axis: "vertical",
    initialSize: DEFAULT_PANEL_HEIGHT,
    min: MIN_PANEL_HEIGHT,
    max: MAX_PANEL_HEIGHT,
    invert: true,
  })

  const isResizing = sidebarPane.resizing || panelPane.resizing

  const handleSelectView = useCallback(
    (view: ActivityView) => {
      setActiveView(view)
      if (isMobile) setSidebarOpen(true)
    },
    [isMobile],
  )

  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open)
  }, [])

  return (
    <div className={mergeClasses(styles.root, isResizing && styles.resizing)}>
      <TitleBar
        onToggleSidebar={handleToggleSidebar}
        showSidebarToggle={isMobile}
        onCompile={handleCompile}
        onRun={handleRun}
        onDebug={handleDebug}
        onClean={handleClean}
        onNewProject={handleNewProject}
        onNewSolution={handleNewSolution}
        onNewSolutionInFolder={handleNewSolutionInFolder}
        onOpenSolutionFromFolder={handleOpenSolutionFromFolder}
        isBusy={isBusy}
      />
      <div className={styles.main}>
        <div className={styles.workbench}>
          <ActivityBar active={activeView} onSelect={handleSelectView} />
          {isMobile ? (
            sidebarOpen && (
              <>
                <div className={styles.sidebarOverlay} onClick={() => setSidebarOpen(false)} />
                <div className={styles.sidebarMobile}>
                  <SideBar view={activeView} width={DEFAULT_SIDEBAR_WIDTH} />
                </div>
              </>
            )
          ) : (
            <SideBar
              view={activeView}
              width={sidebarPane.size}
              onResizeStart={sidebarPane.handleResizeStart}
              resizing={sidebarPane.resizing}
            />
          )}
          <EditorArea />
        </div>
        {panelOpen && (
          <Panel height={panelPane.size} onResizeStart={panelPane.handleResizeStart} resizing={panelPane.resizing} />
        )}
      </div>
      <StatusBar panelOpen={panelOpen} onTogglePanel={togglePanel} />
    </div>
  )
}
