import { useState, useCallback } from "react"
import {
  makeStyles,
  tokens,
  mergeClasses,
  Text,
  Button,
  Input,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  MenuDivider,
} from "@fluentui/react-components"
import {
  AppsListDetailRegular,
  AppsListDetailFilled,
  MoreHorizontalRegular,
  ChevronRightRegular,
  ChevronDownRegular,
  PlayRegular,
  WrenchRegular,
  BugRegular,
  StarRegular,
  StarFilled,
  EditRegular,
  DeleteRegular,
  LinkRegular,
  bundleIcon,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import { useProject } from "../../app/project/project-context"
import { useDebug } from "../../app/debug/debug-context"
import { useLog } from "../../app/panel/log-context"
import type { ProjectDto } from "../../app/project/types"
import { FileTree } from "./FileTree"
import { DependenciesTree } from "./DependenciesTree"
import { AddReferenceDialog } from "./AddReferenceDialog"

const ProjectIcon = bundleIcon(AppsListDetailFilled, AppsListDetailRegular)

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    columnGap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalXS}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    fontSize: "12px",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground3Hover,
    },
  },
  headerSelected: {
    backgroundColor: tokens.colorNeutralBackground3,
  },
  chevron: {
    flexShrink: 0,
    fontSize: "12px",
  },
  name: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "12px",
  },
  nameStartup: {
    fontWeight: tokens.fontWeightSemibold,
  },
  moreButton: {
    minWidth: "20px",
    width: "20px",
    height: "20px",
    visibility: "hidden",
  },
  moreButtonVisible: {
    visibility: "visible",
  },
  body: {
    paddingLeft: tokens.spacingHorizontalL,
  },
  renameInput: {
    flexGrow: 1,
    minWidth: 0,
  },
})

interface ProjectNodeProps {
  project: ProjectDto
}

export function ProjectNode({ project: p }: ProjectNodeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const project = useProject()
  const { startDebug } = useDebug()
  const { appendLine, clear, showChannel } = useLog()
  const [open, setOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [referenceDialogOpen, setReferenceDialogOpen] = useState(false)

  const isStartup = project.startupProjectId === p.id
  const isSelected = project.explorerSelection?.projectId === p.id && project.explorerSelection.entryId === null
  const projectPendingCreate = project.pendingCreate?.projectId === p.id ? project.pendingCreate : null
  // A pending create targeting this project should reveal it even if the user had collapsed it.
  const isOpen = open || projectPendingCreate !== null

  const referencedIds = project.projectReferences[p.id] ?? []
  const referencedNames = referencedIds
    .map((id) => project.projects.find((other) => other.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const otherProjects = project.projects.filter((other) => other.id !== p.id)

  const handleRemove = useCallback(() => {
    if (window.confirm(t("project.removeConfirm", { name: p.name }))) {
      void project.removeProject(p.id)
    }
  }, [project, p.id, p.name, t])

  const handleBuild = useCallback(async () => {
    showChannel("output")
    clear("output")
    appendLine("output", t("run.compiling"))
    const result = await project.compileProject(p.id)
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.fileName ? `${diagnostic.fileName}(${diagnostic.line},${diagnostic.column}): ` : ""
      appendLine("output", `${location}${diagnostic.severity}: ${diagnostic.message}`)
    }
    appendLine("output", result.success ? t("run.succeeded") : t("run.failed"))
  }, [project, p.id, appendLine, clear, showChannel, t])

  const handleRun = useCallback(async () => {
    showChannel("output")
    clear("output")
    appendLine("output", t("run.compiling"))
    const result = await project.runProject(p.id)
    for (const diagnostic of result.diagnostics) {
      const location = diagnostic.fileName ? `${diagnostic.fileName}(${diagnostic.line},${diagnostic.column}): ` : ""
      appendLine("output", `${location}${diagnostic.severity}: ${diagnostic.message}`)
    }
    if (!result.success) {
      appendLine("output", t("run.failed"))
    } else {
      for (const line of result.output.split("\n")) if (line.length > 0) appendLine("output", line)
      if (result.exceptionMessage) appendLine("output", result.exceptionMessage)
      appendLine("output", t("run.finished"))
    }
  }, [project, p.id, appendLine, clear, showChannel, t])

  if (renaming) {
    return (
      <div className={styles.header}>
        <ProjectIcon fontSize={14} />
        <Input
          className={styles.renameInput}
          size="small"
          autoFocus
          defaultValue={p.name}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const value = (e.target as HTMLInputElement).value.trim()
              if (value) void project.renameProject(p.id, value)
              setRenaming(false)
            } else if (e.key === "Escape") setRenaming(false)
          }}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value && value !== p.name) void project.renameProject(p.id, value)
            setRenaming(false)
          }}
        />
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <div
        className={mergeClasses(styles.header, isSelected && styles.headerSelected)}
        onClick={() => {
          project.setExplorerSelection({ projectId: p.id, entryId: null, parentPath: undefined })
          setOpen((v) => !v)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuOpen(true)
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isOpen ? <ChevronDownRegular className={styles.chevron} /> : <ChevronRightRegular className={styles.chevron} />}
        <ProjectIcon fontSize={14} />
        <Text className={mergeClasses(styles.name, isStartup && styles.nameStartup)} title={p.name}>
          {p.name}
        </Text>
        <Menu open={menuOpen} onOpenChange={(_, data) => setMenuOpen(data.open)}>
          <MenuTrigger disableButtonEnhancement>
            <Button
              appearance="subtle"
              size="small"
              className={mergeClasses(styles.moreButton, (hovered || menuOpen) && styles.moreButtonVisible)}
              icon={<MoreHorizontalRegular />}
              aria-label={t("project.menu")}
              onClick={(e) => e.stopPropagation()}
            />
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem icon={<PlayRegular />} onClick={() => void handleRun()}>
                {t("project.run")}
              </MenuItem>
              <MenuItem icon={<WrenchRegular />} onClick={() => void handleBuild()}>
                {t("project.build")}
              </MenuItem>
              <MenuItem icon={<BugRegular />} onClick={() => void startDebug(p.id)}>
                {t("project.debug")}
              </MenuItem>
              <MenuDivider />
              <MenuItem
                icon={isStartup ? <StarFilled /> : <StarRegular />}
                disabled={isStartup}
                onClick={() => void project.setStartupProject(p.id)}
              >
                {t("project.setStartup")}
              </MenuItem>
              <MenuItem icon={<LinkRegular />} onClick={() => setReferenceDialogOpen(true)}>
                {t("project.addReference")}
              </MenuItem>
              <MenuDivider />
              <MenuItem icon={<EditRegular />} onClick={() => setRenaming(true)}>
                {t("project.rename")}
              </MenuItem>
              <MenuItem icon={<DeleteRegular />} disabled={project.projects.length <= 1} onClick={handleRemove}>
                {t("project.remove")}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </div>
      {isOpen && (
        <div className={styles.body}>
          <FileTree
            files={p.files}
            selectedId={project.explorerSelection?.projectId === p.id ? project.explorerSelection.entryId : null}
            pendingCreate={projectPendingCreate}
            onOpenFile={(node) => void project.openFile(p.id, node)}
            onSelectEntry={(id, parentPath) => project.setExplorerSelection({ projectId: p.id, entryId: id, parentPath })}
            onAddFile={(parentPath, name) => void project.addFile(p.id, parentPath, name)}
            onAddFolder={(parentPath, name) => void project.addFolder(p.id, parentPath, name)}
            onRename={(id, newName) => void project.renameEntry(p.id, id, newName)}
            onDelete={(id) => void project.deleteEntry(p.id, id)}
            onConsumePendingCreate={project.cancelCreate}
          />
          <DependenciesTree project={p} referencedProjectNames={referencedNames} />
        </div>
      )}
      <AddReferenceDialog
        open={referenceDialogOpen}
        onOpenChange={setReferenceDialogOpen}
        otherProjects={otherProjects}
        currentReferenceIds={referencedIds}
        onSave={(ids) => void project.setProjectReferences(p.id, ids)}
      />
    </div>
  )
}
