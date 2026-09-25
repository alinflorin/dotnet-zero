import { makeStyles, tokens, Text, Button, mergeClasses } from "@fluentui/react-components"
import { PanelBottomRegular, PanelBottomFilled, bundleIcon } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"

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
})

interface StatusBarProps {
  panelOpen?: boolean
  onTogglePanel?: () => void
}

export function StatusBar({ panelOpen, onTogglePanel }: StatusBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <Text className={styles.text}>{t("statusBar.ready")}</Text>
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
