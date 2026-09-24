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
  const { runProject } = useProject()
  const { appendLine, clear } = useLog()
  const [activeView, setActiveView] = useState<ActivityView>("explorer")
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [isRunning, setIsRunning] = useState(false)

  const handleRun = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setPanelOpen(true)
    clear("output")
    appendLine("output", t("run.compiling"))
    try {
      const result = await runProject()
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
    } catch (error) {
      appendLine("output", String(error))
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, runProject, appendLine, clear, t])

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

  const handleTogglePanel = useCallback(() => {
    setPanelOpen((open) => !open)
  }, [])

  return (
    <div className={mergeClasses(styles.root, isResizing && styles.resizing)}>
      <TitleBar
        onToggleSidebar={handleToggleSidebar}
        showSidebarToggle={isMobile}
        onRun={handleRun}
        isRunning={isRunning}
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
          <Panel
            height={panelPane.size}
            onResizeStart={panelPane.handleResizeStart}
            resizing={panelPane.resizing}
            onClose={() => setPanelOpen(false)}
          />
        )}
      </div>
      <StatusBar panelOpen={panelOpen} onTogglePanel={handleTogglePanel} />
    </div>
  )
}
