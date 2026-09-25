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
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
} from "@fluentui/react-components"
import { AddRegular, ArrowDownloadRegular, MoreHorizontalRegular } from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"
import { ProjectNode } from "./ProjectNode"

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
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
  },
  solutionHeader: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    padding: tokens.spacingHorizontalXS,
    fontSize: "12px",
    fontWeight: tokens.fontWeightSemibold,
  },
  solutionName: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "12px",
  },
  projects: {
    display: "flex",
    flexDirection: "column",
    padding: tokens.spacingHorizontalXXS,
  },
})

export function ExplorerPanel() {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [projectName, setProjectName] = useState("MyProject")
  const [newProjectName, setNewProjectName] = useState("Project2")

  if (project.status === "loading") {
    return <Spinner size="small" label={t("sidebar.loading")} />
  }

  if (project.status === "empty" || project.projects.length === 0) {
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
                  void project.createSolution(name)
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
    <div className={styles.root}>
      <div className={styles.solutionHeader}>
        <Text className={styles.solutionName} title={project.solutionName ?? ""}>
          {t("solution.title", { name: project.solutionName })}
        </Text>
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Button appearance="subtle" size="small" icon={<MoreHorizontalRegular />} aria-label={t("solution.menu")} />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<AddRegular />} onClick={() => setAddProjectOpen(true)}>
                {t("solution.newProject")}
              </MenuItem>
              <MenuItem icon={<ArrowDownloadRegular />} onClick={() => void project.exportSlnx()}>
                {t("solution.exportSlnx")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      <div className={styles.projects}>
        {project.projects.map((p) => (
          <ProjectNode key={p.id} project={p} />
        ))}
      </div>
      <Dialog open={addProjectOpen} onOpenChange={(_, data) => setAddProjectOpen(data.open)}>
        <DialogSurface>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const name = newProjectName.trim()
              if (!name) return
              setAddProjectOpen(false)
              void project.addProject(name)
            }}
          >
            <DialogBody>
              <DialogTitle>{t("solution.newProject")}</DialogTitle>
              <DialogContent>
                <Input
                  autoFocus
                  value={newProjectName}
                  onChange={(_, data) => setNewProjectName(data.value)}
                  placeholder={t("sidebar.projectNamePlaceholder")}
                />
              </DialogContent>
              <DialogActions>
                <DialogTrigger disableButtonEnhancement>
                  <Button appearance="secondary">{t("common.cancel")}</Button>
                </DialogTrigger>
                <Button appearance="primary" type="submit" disabled={!newProjectName.trim()}>
                  {t("common.add")}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
