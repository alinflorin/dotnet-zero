import { makeStyles, tokens, Button, mergeClasses } from "@fluentui/react-components"
import { DismissRegular, DocumentRegular } from "@fluentui/react-icons"

export interface EditorFile {
  id: string
  name: string
  language: string
  isDirty?: boolean
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    alignItems: "stretch",
    height: "35px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    overflowX: "auto",
  },
  tab: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalSNudge,
    paddingLeft: tokens.spacingHorizontalM,
    paddingRight: tokens.spacingHorizontalSNudge,
    minWidth: "120px",
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    cursor: "pointer",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    userSelect: "none",
    flexShrink: 0,
  },
  tabActive: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    borderTop: `1px solid ${tokens.colorBrandStroke1}`,
  },
  tabName: {
    flexGrow: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  closeButton: {
    minWidth: "20px",
    width: "20px",
    height: "20px",
  },
  dirtyDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: tokens.colorNeutralForeground1,
    flexShrink: 0,
  },
})

interface EditorTabsProps {
  files: EditorFile[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export function EditorTabs({ files, activeId, onSelect, onClose }: EditorTabsProps) {
  const styles = useStyles()

  return (
    <div className={styles.root} role="tablist">
      {files.map((file) => {
        const isActive = file.id === activeId
        return (
          <div
            key={file.id}
            role="tab"
            aria-selected={isActive}
            className={mergeClasses(styles.tab, isActive && styles.tabActive)}
            onClick={() => onSelect(file.id)}
          >
            <DocumentRegular fontSize={16} />
            <span className={styles.tabName}>{file.name}</span>
            {file.isDirty ? (
              <span className={styles.dirtyDot} />
            ) : (
              <Button
                appearance="subtle"
                size="small"
                className={styles.closeButton}
                icon={<DismissRegular fontSize={14} />}
                onClick={(event) => {
                  event.stopPropagation()
                  onClose(file.id)
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
