import {
  makeStyles,
  tokens,
  Text,
  Button,
  Spinner,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components"
import {
  NavigationRegular,
  WrenchRegular,
  WrenchFilled,
  PlayRegular,
  PlayFilled,
  BroomRegular,
  BroomFilled,
  BugRegular,
  BugFilled,
  AddRegular,
  ArrowDownloadRegular,
  bundleIcon,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"

const Wrench = bundleIcon(WrenchFilled, WrenchRegular)
const Play = bundleIcon(PlayFilled, PlayRegular)
const Broom = bundleIcon(BroomFilled, BroomRegular)
const Bug = bundleIcon(BugFilled, BugRegular)

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
  },
  menuButton: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ["-webkit-app-region" as any]: "no-drag",
    fontSize: tokens.fontSizeBase200,
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
  onDebug?: () => void
  onClean?: () => void
  onNewProject?: () => void
  onNewSolution?: () => void
  isBusy?: boolean
}

export function TitleBar({
  onToggleSidebar,
  showSidebarToggle,
  onCompile,
  onRun,
  onDebug,
  onClean,
  onNewProject,
  onNewSolution,
  isBusy,
}: TitleBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()

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
      {project.projects.length > 0 && (
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="transparent" size="small" className={styles.menuButton}>
              {t("project.menu")}
            </Button>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<AddRegular />} onClick={onNewProject}>
                {t("solution.newProject")}
              </MenuItem>
              <MenuItem icon={<AddRegular />} onClick={onNewSolution}>
                {t("solution.newSolution")}
              </MenuItem>
              <MenuItem icon={<ArrowDownloadRegular />} onClick={() => void project.exportSlnx()}>
                {t("solution.exportSlnx")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      )}
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
      {onDebug && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.actionButton}
          icon={<Bug />}
          onClick={onDebug}
          disabled={isBusy}
          aria-label={t("run.debug")}
          title={t("run.debug")}
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
