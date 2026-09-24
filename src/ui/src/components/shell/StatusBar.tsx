import { makeStyles, tokens, Text } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: "22px",
    flexShrink: 0,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalM,
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
})

export function StatusBar() {
  const styles = useStyles()
  const { t } = useTranslation()

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        <Text className={styles.text}>{t("statusBar.ready")}</Text>
      </div>
      <div className={styles.group}>
        <Text className={styles.text}>UTF-8</Text>
      </div>
    </div>
  )
}
