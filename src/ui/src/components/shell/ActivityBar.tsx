import { makeStyles, tokens, Tooltip, Button, mergeClasses } from "@fluentui/react-components"
import {
  FolderRegular,
  FolderFilled,
  SearchRegular,
  SearchFilled,
  BugRegular,
  BugFilled,
  BoxRegular,
  BoxFilled,
  SettingsRegular,
  SettingsFilled,
  bundleIcon,
  type FluentIcon,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"

const Folder = bundleIcon(FolderFilled, FolderRegular)
const Search = bundleIcon(SearchFilled, SearchRegular)
const Bug = bundleIcon(BugFilled, BugRegular)
const Box = bundleIcon(BoxFilled, BoxRegular)
const Settings = bundleIcon(SettingsFilled, SettingsRegular)

export type ActivityView = "explorer" | "search" | "debug" | "extensions" | "settings"

interface ActivityItem {
  id: ActivityView
  icon: FluentIcon
  labelKey: string
}

const items: ActivityItem[] = [
  { id: "explorer", icon: Folder, labelKey: "activityBar.explorer" },
  { id: "search", icon: Search, labelKey: "activityBar.search" },
  { id: "debug", icon: Bug, labelKey: "activityBar.debug" },
  { id: "extensions", icon: Box, labelKey: "activityBar.nuget" },
]

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    width: "48px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: tokens.spacingVerticalS,
    rowGap: tokens.spacingVerticalXS,
  },
  itemButton: {
    minWidth: "40px",
    width: "40px",
    height: "40px",
    borderRadius: tokens.borderRadiusMedium,
  },
  itemButtonActive: {
    backgroundColor: tokens.colorNeutralBackground3Selected,
  },
})

interface ActivityBarProps {
  active: ActivityView
  onSelect: (view: ActivityView) => void
}

export function ActivityBar({ active, onSelect }: ActivityBarProps) {
  const styles = useStyles()
  const { t } = useTranslation()

  return (
    <div className={styles.root}>
      <div className={styles.group}>
        {items.map((item) => {
          const Icon = item.icon
          const isActive = active === item.id
          return (
            <Tooltip key={item.id} content={t(item.labelKey)} relationship="label" positioning="after">
              <Button
                appearance="subtle"
                className={mergeClasses(styles.itemButton, isActive && styles.itemButtonActive)}
                icon={<Icon />}
                onClick={() => onSelect(item.id)}
                aria-pressed={isActive}
              />
            </Tooltip>
          )
        })}
      </div>
      <div className={styles.group} style={{ paddingBottom: tokens.spacingVerticalS }}>
        <Tooltip content={t("activityBar.settings")} relationship="label" positioning="after">
          <Button
            appearance="subtle"
            className={mergeClasses(styles.itemButton, active === "settings" && styles.itemButtonActive)}
            icon={<Settings />}
            onClick={() => onSelect("settings")}
            aria-pressed={active === "settings"}
          />
        </Tooltip>
      </div>
    </div>
  )
}
