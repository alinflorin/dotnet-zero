import { useCallback, useEffect, useRef, useState } from "react"
import { makeStyles, tokens, mergeClasses } from "@fluentui/react-components"
import { TitleBar } from "./TitleBar"
import { ActivityBar, type ActivityView } from "./ActivityBar"
import { SideBar } from "./SideBar"
import { StatusBar } from "./StatusBar"
import { EditorArea } from "../editor/EditorArea"

const MOBILE_QUERY = "(max-width: 768px)"
const DEFAULT_SIDEBAR_WIDTH = 260
const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480

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
    cursor: "col-resize",
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
  const [activeView, setActiveView] = useState<ActivityView>("explorer")
  const isMobile = useIsMobile()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [resizing, setResizing] = useState(false)
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null)

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

  const handleResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      resizeStartRef.current = { x: event.clientX, width: sidebarWidth }
      setResizing(true)
    },
    [sidebarWidth],
  )

  useEffect(() => {
    if (!resizing) return

    const handleMove = (event: PointerEvent) => {
      const start = resizeStartRef.current
      if (!start) return
      const next = start.width + (event.clientX - start.x)
      setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, next)))
    }
    const handleUp = () => {
      resizeStartRef.current = null
      setResizing(false)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
  }, [resizing])

  return (
    <div className={mergeClasses(styles.root, resizing && styles.resizing)}>
      <TitleBar onToggleSidebar={handleToggleSidebar} showSidebarToggle={isMobile} />
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
            width={sidebarWidth}
            onResizeStart={handleResizeStart}
            resizing={resizing}
          />
        )}
        <EditorArea />
      </div>
      <StatusBar />
    </div>
  )
}
