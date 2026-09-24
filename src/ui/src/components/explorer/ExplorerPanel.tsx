import { useState } from "react"
import {
  makeStyles,
  tokens,
  Text,
  Button,
  Spinner,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Tooltip,
} from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"
import { FileTree } from "./FileTree"

const useStyles = makeStyles({
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    rowGap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    textAlign: "center",
  },
  actions: {
    display: "flex",
    flexDirection: "column",
    rowGap: tokens.spacingVerticalS,
    width: "100%",
  },
  tree: {
    width: "100%",
    padding: tokens.spacingHorizontalXS,
  },
})

export function ExplorerPanel() {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState("MyProject")

  if (project.status === "loading") {
    return <Spinner size="small" label={t("sidebar.loading")} />
  }

  if (project.status === "empty" || !project.project) {
    return (
      <div className={styles.empty}>
        <Text className={styles.emptyText}>{t("sidebar.noFolder")}</Text>
        <div className={styles.actions}>
          <Dialog open={dialogOpen} onOpenChange={(_, data) => setDialogOpen(data.open)}>
            <DialogTrigger disableButtonEnhancement>
              <Button appearance="primary" size="small">
                {t("sidebar.newProject")}
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const name = projectName.trim()
                  if (!name) return
                  setDialogOpen(false)
                  void project.createProject(name)
                }}
              >
                <DialogBody>
                  <DialogTitle>{t("sidebar.newProject")}</DialogTitle>
                  <DialogContent>
                    <Input
                      autoFocus
                      value={projectName}
                      onChange={(_, data) => setProjectName(data.value)}
                      placeholder={t("sidebar.projectNamePlaceholder")}
                    />
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button appearance="secondary">{t("common.cancel")}</Button>
                    </DialogTrigger>
                    <Button appearance="primary" type="submit" disabled={!projectName.trim()}>
                      {t("common.create")}
                    </Button>
                  </DialogActions>
                </DialogBody>
              </form>
            </DialogSurface>
          </Dialog>
          <Tooltip content={t("sidebar.openFolderComingSoon")} relationship="label">
            <Button appearance="secondary" size="small" disabled>
              {t("sidebar.openFolder")}
            </Button>
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.tree}>
      <FileTree
        files={project.project.files}
        onOpenFile={(node) => void project.openFile(node)}
        onAddFile={(parentPath, name) => void project.addFile(parentPath, name)}
        onAddFolder={(parentPath, name) => void project.addFolder(parentPath, name)}
        onRename={(id, newName) => void project.renameEntry(id, newName)}
        onDelete={(id) => void project.deleteEntry(id)}
      />
    </div>
  )
}
