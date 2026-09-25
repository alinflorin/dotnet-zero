import { makeStyles, tokens, Text, Button, Spinner } from "@fluentui/react-components"
import {
  NavigationRegular,
  WrenchRegular,
  WrenchFilled,
  PlayRegular,
  PlayFilled,
  PlaySettingsRegular,
  PlaySettingsFilled,
  BroomRegular,
  BroomFilled,
  bundleIcon,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"

const Wrench = bundleIcon(WrenchFilled, WrenchRegular)
const Play = bundleIcon(PlayFilled, PlayRegular)
const PlaySettings = bundleIcon(PlaySettingsFilled, PlaySettingsRegular)
const Broom = bundleIcon(BroomFilled, BroomRegular)

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
  actionButton: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "no-drag",
    color: tokens.colorPaletteGreenForeground1,
  },
  cleanButton: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "no-drag",
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
  onCompile?: () => void
  onRun?: () => void
  onCompileAndRun?: () => void
  onClean?: () => void
  isBusy?: boolean
}

export function TitleBar({
  onToggleSidebar,
  showSidebarToggle,
  onCompile,
  onRun,
  onCompileAndRun,
  onClean,
  isBusy,
}: TitleBarProps) {
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
      {isBusy && <Spinner size="tiny" />}
      {onCompile && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.actionButton}
          icon={<Wrench />}
          onClick={onCompile}
          disabled={isBusy}
          aria-label={t("run.compile")}
          title={t("run.compile")}
        />
      )}
      {onRun && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.actionButton}
          icon={<Play />}
          onClick={onRun}
          disabled={isBusy}
          aria-label={t("run.run")}
          title={t("run.run")}
        />
      )}
      {onCompileAndRun && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.actionButton}
          icon={<PlaySettings />}
          onClick={onCompileAndRun}
          disabled={isBusy}
          aria-label={t("run.compileAndRun")}
          title={t("run.compileAndRun")}
        />
      )}
      {onClean && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.cleanButton}
          icon={<Broom />}
          onClick={onClean}
          disabled={isBusy}
          aria-label={t("run.clean")}
          title={t("run.clean")}
        />
      )}
    </div>
  )
}
