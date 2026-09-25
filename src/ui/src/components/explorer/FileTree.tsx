import { useState } from "react"
import {
  Tree,
  TreeItem,
  TreeItemLayout,
  Menu,
  MenuTrigger,
  MenuPopover,
  MenuList,
  MenuItem,
  Input,
  Button,
  makeStyles,
  tokens,
  mergeClasses,
} from "@fluentui/react-components"
import type { TreeItemOpenChangeData, TreeItemOpenChangeEvent } from "@fluentui/react-components"
import {
  FolderRegular,
  DocumentRegular,
  MoreHorizontalRegular,
  AddRegular,
  FolderAddRegular,
  EditRegular,
  DeleteRegular,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
import type { PendingCreate } from "../../app/project/project-context"
import type { ProjectFileNode } from "../../app/project/types"

type EditingState =
  | { mode: "create-file" | "create-folder"; parentPath: string | undefined }
  | { mode: "rename"; id: string; initialName: string }
  | null

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    fontSize: "12px",
  },
  rowLabel: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "12px",
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
  editInput: {
    flexGrow: 1,
    minWidth: 0,
  },
  selected: {
    backgroundColor: tokens.colorNeutralBackground3,
  },
})

interface FileTreeProps {
  files: ProjectFileNode[]
  selectedId: string | null
  pendingCreate: PendingCreate | null
  onOpenFile: (node: ProjectFileNode) => void
  onSelectEntry: (id: string, parentPath: string | undefined) => void
  onAddFile: (parentPath: string | undefined, name: string) => void
  onAddFolder: (parentPath: string | undefined, name: string) => void
  onRename: (id: string, newName: string) => void
  onDelete: (id: string) => void
  onConsumePendingCreate: () => void
}

export function FileTree({
  files,
  selectedId,
  pendingCreate,
  onOpenFile,
  onSelectEntry,
  onAddFile,
  onAddFolder,
  onRename,
  onDelete,
  onConsumePendingCreate,
}: FileTreeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [openItems, setOpenItems] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditingState>(null)

  // pendingCreate is a one-shot request from outside the tree (e.g. the toolbar above it). It is
  // folded into the local editing state on render rather than mirrored via an effect, and consumed
  // (cleared upstream) as soon as it has been picked up.
  const activeEditing: EditingState =
    editing ??
    (pendingCreate
      ? { mode: pendingCreate.mode === "file" ? "create-file" : "create-folder", parentPath: pendingCreate.parentPath }
      : null)
  const effectiveOpenItems =
    pendingCreate?.parentPath && !openItems.has(pendingCreate.parentPath)
      ? new Set(openItems).add(pendingCreate.parentPath)
      : openItems

  const handleOpenChange = (_event: TreeItemOpenChangeEvent, data: TreeItemOpenChangeData) => {
    setOpenItems((prev) => {
      const next = new Set(prev)
      if (data.open) next.add(String(data.value))
      else next.delete(String(data.value))
      return next
    })
  }

  const commitEdit = (name: string) => {
    const trimmed = name.trim()
    if (trimmed) {
      if (activeEditing?.mode === "create-file") onAddFile(activeEditing.parentPath, trimmed)
      else if (activeEditing?.mode === "create-folder") onAddFolder(activeEditing.parentPath, trimmed)
      else if (activeEditing?.mode === "rename") onRename(activeEditing.id, trimmed)
    }
    setEditing(null)
    onConsumePendingCreate()
  }

  const cancelEdit = () => {
    setEditing(null)
    onConsumePendingCreate()
  }

  const editingRow = activeEditing && (
    <EditRow
      key="__editing__"
      initialValue={activeEditing.mode === "rename" ? activeEditing.initialName : ""}
      onCommit={commitEdit}
      onCancel={cancelEdit}
    />
  )

  return (
    <div className={styles.root}>
      <Tree
        size="small"
        aria-label={t("sidebar.explorer.title")}
        openItems={effectiveOpenItems}
        onOpenChange={handleOpenChange}
      >
        {files.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            parentId={undefined}
            selectedId={selectedId}
            editing={activeEditing}
            onSetEditing={setEditing}
            onOpenFile={onOpenFile}
            onSelectEntry={onSelectEntry}
            onDelete={onDelete}
            commitEdit={commitEdit}
            cancelEdit={cancelEdit}
          />
        ))}
        {activeEditing && activeEditing.mode !== "rename" && activeEditing.parentPath === undefined ? editingRow : null}
      </Tree>
    </div>
  )
}

function EditRow({
  initialValue,
  onCommit,
  onCancel,
}: {
  initialValue: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const styles = useStyles()
  const [value, setValue] = useState(initialValue)

  return (
    <TreeItem itemType="leaf" value="__editing__">
      <TreeItemLayout>
        <Input
          className={styles.editInput}
          size="small"
          autoFocus
          value={value}
          onChange={(_, data) => setValue(data.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(value)
            else if (e.key === "Escape") onCancel()
          }}
          onBlur={() => onCommit(value)}
        />
      </TreeItemLayout>
    </TreeItem>
  )
}

interface FileTreeNodeProps {
  node: ProjectFileNode
  parentId: string | undefined
  selectedId: string | null
  editing: EditingState
  onSetEditing: (state: EditingState) => void
  onOpenFile: (node: ProjectFileNode) => void
  onSelectEntry: (id: string, parentPath: string | undefined) => void
  onDelete: (id: string) => void
  commitEdit: (name: string) => void
  cancelEdit: () => void
}

function FileTreeNode({
  node,
  parentId,
  selectedId,
  editing,
  onSetEditing,
  onOpenFile,
  onSelectEntry,
  onDelete,
  commitEdit,
  cancelEdit,
}: FileTreeNodeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const isFolder = node.kind === "folder"
  const isProjectFile = node.kind === "file" && node.name.endsWith(".csproj")
  const isRenamingThis = editing?.mode === "rename" && editing.id === node.id
  const childEditing = editing && editing.mode !== "rename" && editing.parentPath === node.id ? editing : null

  if (isRenamingThis) {
    return (
      <TreeItem itemType="leaf" value={node.id}>
        <TreeItemLayout>
          <Input
            className={styles.editInput}
            size="small"
            autoFocus
            defaultValue={editing.initialName}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit((e.target as HTMLInputElement).value)
              else if (e.key === "Escape") cancelEdit()
            }}
            onBlur={(e) => commitEdit(e.target.value)}
          />
        </TreeItemLayout>
      </TreeItem>
    )
  }

  const menu = (
    <Menu open={menuOpen} onOpenChange={(_, data) => setMenuOpen(data.open)}>
      <MenuTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          size="small"
          className={mergeClasses(styles.moreButton, (hovered || menuOpen) && styles.moreButtonVisible)}
          icon={<MoreHorizontalRegular />}
          aria-label={t("explorer.moreActions")}
          onClick={(e) => e.stopPropagation()}
        />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {isFolder && (
            <MenuItem icon={<AddRegular />} onClick={() => onSetEditing({ mode: "create-file", parentPath: node.id })}>
              {t("explorer.newFile")}
            </MenuItem>
          )}
          {isFolder && (
            <MenuItem
              icon={<FolderAddRegular />}
              onClick={() => onSetEditing({ mode: "create-folder", parentPath: node.id })}
            >
              {t("explorer.newFolder")}
            </MenuItem>
          )}
          {!isProjectFile && (
            <MenuItem
              icon={<EditRegular />}
              onClick={() => onSetEditing({ mode: "rename", id: node.id, initialName: node.name })}
            >
              {t("explorer.rename")}
            </MenuItem>
          )}
          {!isProjectFile && (
            <MenuItem icon={<DeleteRegular />} onClick={() => onDelete(node.id)}>
              {t("explorer.delete")}
            </MenuItem>
          )}
        </MenuList>
      </MenuPopover>
    </Menu>
  )

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenuOpen(true)
  }

  if (!isFolder) {
    return (
      <TreeItem
        itemType="leaf"
        value={node.id}
        className={selectedId === node.id ? styles.selected : undefined}
        onClick={() => {
          onSelectEntry(node.id, parentId)
          onOpenFile(node)
        }}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <TreeItemLayout iconBefore={<DocumentRegular fontSize={14} />} actions={isProjectFile ? undefined : menu}>
          <span className={styles.rowLabel}>{node.name}</span>
        </TreeItemLayout>
      </TreeItem>
    )
  }

  return (
    <TreeItem
      itemType="branch"
      value={node.id}
      className={selectedId === node.id ? styles.selected : undefined}
      onClick={() => onSelectEntry(node.id, node.id)}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TreeItemLayout iconBefore={<FolderRegular fontSize={14} />} actions={menu}>
        <span className={styles.rowLabel}>{node.name}</span>
      </TreeItemLayout>
      <Tree>
        {(node.children ?? []).map((child) => (
          <FileTreeNode
            key={child.id}
            node={child}
            parentId={node.id}
            selectedId={selectedId}
            editing={editing}
            onSetEditing={onSetEditing}
            onOpenFile={onOpenFile}
            onSelectEntry={onSelectEntry}
            onDelete={onDelete}
            commitEdit={commitEdit}
            cancelEdit={cancelEdit}
          />
        ))}
        {childEditing ? (
          <EditRow
            initialValue=""
            onCommit={commitEdit}
            onCancel={cancelEdit}
          />
        ) : null}
      </Tree>
    </TreeItem>
  )
}
