import { useState } from "react"
import { makeStyles, tokens, mergeClasses, Button } from "@fluentui/react-components"
import { DismissRegular } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useLog, type LogChannel } from "../../app/panel/log-context"

const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  resizeHandle: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "4px",
    cursor: "row-resize",
    zIndex: 1,
    ":hover": {
      backgroundColor: tokens.colorNeutralStroke1,
    },
  },
  resizeHandleActive: {
    backgroundColor: tokens.colorCompoundBrandStroke,
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "32px",
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalXS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  tabs: {
    display: "flex",
    columnGap: tokens.spacingHorizontalM,
    height: "100%",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    cursor: "pointer",
    userSelect: "none",
    borderBottom: "2px solid transparent",
  },
  tabActive: {
    color: tokens.colorNeutralForeground1,
    borderBottomColor: tokens.colorBrandStroke1,
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    padding: tokens.spacingHorizontalS,
    whiteSpace: "pre-wrap",
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
  },
  line: {
    lineHeight: "18px",
  },
})

interface PanelProps {
  height: number
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  resizing: boolean
  onClose: () => void
}

const CHANNELS: { id: LogChannel; labelKey: string }[] = [
  { id: "output", labelKey: "panel.output" },
  { id: "debug", labelKey: "panel.debugConsole" },
]

export function Panel({ height, onResizeStart, resizing, onClose }: PanelProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const { lines } = useLog()
  const [active, setActive] = useState<LogChannel>("output")

  const visibleLines = lines.filter((line) => line.channel === active)

  return (
    <div className={styles.root} style={{ height: `${height}px` }}>
      <div
        className={mergeClasses(styles.resizeHandle, resizing && styles.resizeHandleActive)}
        onPointerDown={onResizeStart}
      />
      <div className={styles.tabBar}>
        <div className={styles.tabs} role="tablist">
          {CHANNELS.map((channel) => (
            <div
              key={channel.id}
              role="tab"
              aria-selected={active === channel.id}
              className={mergeClasses(styles.tab, active === channel.id && styles.tabActive)}
              onClick={() => setActive(channel.id)}
            >
              {t(channel.labelKey)}
            </div>
          ))}
        </div>
        <Button
          appearance="subtle"
          size="small"
          icon={<DismissRegular />}
          aria-label={t("panel.close")}
          title={t("panel.close")}
          onClick={onClose}
        />
      </div>
      <div className={styles.body}>
        {visibleLines.length === 0 ? (
          <span className={styles.emptyText}>{t("panel.empty")}</span>
        ) : (
          visibleLines.map((line) => (
            <div key={line.id} className={styles.line}>
              {line.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
