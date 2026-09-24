import { makeStyles, tokens, Text, Button, Spinner } from "@fluentui/react-components"
import { NavigationRegular, PlayRegular, PlayFilled, bundleIcon } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"

const Play = bundleIcon(PlayFilled, PlayRegular)

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    height: "36px",
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalS,
    paddingRight: tokens.spacingHorizontalS,
    columnGap: tokens.spacingHorizontalS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "drag",
  },
  sidebarToggle: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "no-drag",
  },
  runButton: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "no-drag",
    color: tokens.colorPaletteGreenForeground1,
  },
  title: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
  },
  spacer: {
    flexGrow: 1,
  },
})

interface TitleBarProps {
  onToggleSidebar?: () => void
  showSidebarToggle?: boolean
  onRun?: () => void
  isRunning?: boolean
}

export function TitleBar({ onToggleSidebar, showSidebarToggle, onRun, isRunning }: TitleBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()

  return (
    <div className={styles.root}>
      {showSidebarToggle && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.sidebarToggle}
          icon={<NavigationRegular />}
          onClick={onToggleSidebar}
          aria-label={t("shell.toggleSidebar")}
          title={t("shell.toggleSidebar")}
        />
      )}
      <Text className={styles.title}>{t("app.title")}</Text>
      <div className={styles.spacer} />
      {onRun && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.runButton}
          icon={isRunning ? <Spinner size="tiny" /> : <Play />}
          onClick={onRun}
          disabled={isRunning}
          aria-label={t("run.run")}
          title={t("run.run")}
        />
      )}
    </div>
  )
}
