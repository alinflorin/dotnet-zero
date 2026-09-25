import { makeStyles, tokens, Text, Button, Tooltip, mergeClasses } from "@fluentui/react-components"
import { PanelBottomRegular, PanelBottomFilled, FolderSyncRegular, WarningRegular, bundleIcon } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"

const PanelBottom = bundleIcon(PanelBottomFilled, PanelBottomRegular)

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "22px",
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalXS,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  text: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  group: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalM,
  },
  panelToggle: {
    minWidth: "20px",
    width: "20px",
    height: "20px",
    color: tokens.colorNeutralForegroundOnBrand,
    ":hover": {
      backgroundColor: "rgba(255, 255, 255, 0.2)",
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  panelToggleActive: {
    backgroundColor: tokens.colorNeutralForegroundOnBrand,
    color: tokens.colorBrandBackground,
  },
  linkStatus: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXXS,
    fontSize: tokens.fontSizeBase100,
  },
  reconnectButton: {
    minWidth: 0,
    height: "18px",
    paddingLeft: tokens.spacingHorizontalXS,
    paddingRight: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorPaletteYellowForeground1,
    backgroundColor: "rgba(0, 0, 0, 0.15)",
    ":hover": {
      backgroundColor: "rgba(0, 0, 0, 0.25)",
      color: tokens.colorPaletteYellowForeground1,
    },
  },
})

interface StatusBarProps {
  panelOpen?: boolean
  onTogglePanel?: () => void
}

export function StatusBar({ panelOpen, onTogglePanel }: StatusBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const { folderLinkStatus, linkedFolderName, reconnectFolder } = useProject()

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <Text className={styles.text}>{t("statusBar.ready")}</Text>
        {folderLinkStatus === "linked" && linkedFolderName && (
          <Tooltip content={t("statusBar.linkedFolder", { name: linkedFolderName })} relationship="label">
            <div className={styles.linkStatus}>
              <FolderSyncRegular fontSize={12} />
              <Text className={styles.text}>{linkedFolderName}</Text>
            </div>
          </Tooltip>
        )}
        {folderLinkStatus === "permission-needed" && linkedFolderName && (
          <Tooltip content={t("statusBar.reconnectFolder", { name: linkedFolderName })} relationship="label">
            <Button
              appearance="transparent"
              size="small"
              className={styles.reconnectButton}
              icon={<WarningRegular fontSize={12} />}
              onClick={() => void reconnectFolder()}
            >
              {t("statusBar.reconnectFolderShort")}
            </Button>
          </Tooltip>
        )}
      </div>
      <div className={styles.group}>
        <Text className={styles.text}>UTF-8</Text>
        {onTogglePanel && (
          <Button
            appearance="transparent"
            size="small"
            className={mergeClasses(styles.panelToggle, panelOpen && styles.panelToggleActive)}
            icon={<PanelBottom />}
            aria-pressed={panelOpen}
            aria-label={t("panel.toggle")}
            title={t("panel.toggle")}
            onClick={onTogglePanel}
          />
        )}
      </div>
    </div>
  )
}
