import {
  makeStyles,
  tokens,
  Text,
  RadioGroup,
  Radio,
  Label,
  mergeClasses,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import type { ActivityView } from "./ActivityBar"
import { useThemeMode, type ThemeMode } from "../../app/theme/theme-context"
import { ExplorerPanel } from "../explorer/ExplorerPanel"

const useStyles = makeStyles({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    height: "100%",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    height: "35px",
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
    flexShrink: 0,
  },
  headerText: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    color: tokens.colorNeutralForeground2,
  },
  body: {
    flexGrow: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
  },
  stretchBody: {
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  settingsSection: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
  },
  resizeHandle: {
    position: "absolute",
    top: 0,
    right: 0,
    width: "4px",
    height: "100%",
    cursor: "col-resize",
    zIndex: 1,
    ":hover": {
      backgroundColor: tokens.colorNeutralStroke1,
    },
  },
  resizeHandleActive: {
    backgroundColor: tokens.colorCompoundBrandStroke,
  },
})

const titleKeyByView: Partial<Record<ActivityView, string>> = {
  explorer: "sidebar.explorer.title",
  search: "activityBar.search",
  sourceControl: "activityBar.sourceControl",
  debug: "activityBar.debug",
  extensions: "activityBar.extensions",
  settings: "activityBar.settings",
}

interface SideBarProps {
  view: ActivityView
  width?: number
  onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void
  resizing?: boolean
}

const languageOptions = [
  { value: "en", label: "English" },
  { value: "ro", label: "Română" },
]

function SettingsPanel() {
  const styles = useStyles()
  const { t, i18n } = useTranslation()
  const { mode, setMode } = useThemeMode()

  return (
    <>
      <div className={styles.settingsSection}>
        <Label size="small">{t("theme.toggleLabel")}</Label>
        <RadioGroup
          value={mode}
          onChange={(_, data) => setMode(data.value as ThemeMode)}
        >
          <Radio value="light" label={t("theme.light")} />
          <Radio value="dark" label={t("theme.dark")} />
          <Radio value="auto" label={t("theme.auto")} />
        </RadioGroup>
      </div>
      <div className={styles.settingsSection}>
        <Label size="small">{t("language.toggleLabel")}</Label>
        <RadioGroup
          value={i18n.resolvedLanguage ?? "en"}
          onChange={(_, data) => void i18n.changeLanguage(data.value)}
        >
          {languageOptions.map((option) => (
            <Radio key={option.value} value={option.value} label={option.label} />
          ))}
        </RadioGroup>
      </div>
    </>
  )
}

export function SideBar({ view, width, onResizeStart, resizing }: SideBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()

  return (
    <div className={styles.root} style={width !== undefined ? { width: `${width}px` } : undefined}>
      <div className={styles.header}>
        <Text className={styles.headerText}>{t(titleKeyByView[view] ?? "sidebar.explorer.title")}</Text>
      </div>
      <div className={mergeClasses(styles.body, (view === "settings" || view === "explorer") && styles.stretchBody)}>
        {view === "explorer" && <ExplorerPanel />}
        {view === "settings" && <SettingsPanel />}
      </div>
      {onResizeStart && (
        <div
          className={mergeClasses(styles.resizeHandle, resizing && styles.resizeHandleActive)}
          onPointerDown={onResizeStart}
        />
      )}
    </div>
  )
}
