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
  FolderOpenRegular,
  DocumentRegular,
  MoreHorizontalRegular,
  AddRegular,
  FolderAddRegular,
  EditRegular,
  DeleteRegular,
} from "@fluentui/react-icons"
import { useTranslation } from "react-i18next"
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
  },
  toolbar: {
    display: "flex",
    justifyContent: "flex-end",
    columnGap: tokens.spacingHorizontalXS,
    paddingBottom: tokens.spacingVerticalXS,
  },
  row: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    columnGap: tokens.spacingHorizontalXS,
  },
  rowLabel: {
    flexGrow: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
})

interface FileTreeProps {
  files: ProjectFileNode[]
  onOpenFile: (node: ProjectFileNode) => void
  onAddFile: (parentPath: string | undefined, name: string) => void
  onAddFolder: (parentPath: string | undefined, name: string) => void
  onRename: (id: string, newName: string) => void
  onDelete: (id: string) => void
}

export function FileTree({ files, onOpenFile, onAddFile, onAddFolder, onRename, onDelete }: FileTreeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [openItems, setOpenItems] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditingState>(null)

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
    if (!trimmed) {
      setEditing(null)
      return
    }
    if (editing?.mode === "create-file") onAddFile(editing.parentPath, trimmed)
    else if (editing?.mode === "create-folder") onAddFolder(editing.parentPath, trimmed)
    else if (editing?.mode === "rename") onRename(editing.id, trimmed)
    setEditing(null)
  }

  const editingRow = editing && (
    <EditRow
      key="__editing__"
      initialValue={editing.mode === "rename" ? editing.initialName : ""}
      onCommit={commitEdit}
      onCancel={() => setEditing(null)}
    />
  )

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          size="small"
          icon={<AddRegular />}
          title={t("explorer.newFile")}
          aria-label={t("explorer.newFile")}
          onClick={() => setEditing({ mode: "create-file", parentPath: undefined })}
        />
        <Button
          appearance="subtle"
          size="small"
          icon={<FolderAddRegular />}
          title={t("explorer.newFolder")}
          aria-label={t("explorer.newFolder")}
          onClick={() => setEditing({ mode: "create-folder", parentPath: undefined })}
        />
      </div>
      <Tree aria-label={t("sidebar.explorer.title")} openItems={openItems} onOpenChange={handleOpenChange}>
        {files.map((node) => (
          <FileTreeNode
            key={node.id}
            node={node}
            editing={editing}
            onSetEditing={setEditing}
            onOpenFile={onOpenFile}
            onDelete={onDelete}
            commitEdit={commitEdit}
            cancelEdit={() => setEditing(null)}
          />
        ))}
        {editing && editing.mode !== "rename" && editing.parentPath === undefined ? editingRow : null}
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
  editing: EditingState
  onSetEditing: (state: EditingState) => void
  onOpenFile: (node: ProjectFileNode) => void
  onDelete: (id: string) => void
  commitEdit: (name: string) => void
  cancelEdit: () => void
}

function FileTreeNode({ node, editing, onSetEditing, onOpenFile, onDelete, commitEdit, cancelEdit }: FileTreeNodeProps) {
  const styles = useStyles()
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [hovered, setHovered] = useState(false)

  const isFolder = node.kind === "folder"
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
          <MenuItem
            icon={<EditRegular />}
            onClick={() => onSetEditing({ mode: "rename", id: node.id, initialName: node.name })}
          >
            {t("explorer.rename")}
          </MenuItem>
          <MenuItem icon={<DeleteRegular />} onClick={() => onDelete(node.id)}>
            {t("explorer.delete")}
          </MenuItem>
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
        onClick={() => onOpenFile(node)}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <TreeItemLayout iconBefore={<DocumentRegular />}>
          <div className={styles.row}>
            <span className={styles.rowLabel}>{node.name}</span>
            {menu}
          </div>
        </TreeItemLayout>
      </TreeItem>
    )
  }

  return (
    <TreeItem
      itemType="branch"
      value={node.id}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <TreeItemLayout iconBefore={<FolderRegular />} expandIcon={<FolderOpenRegular />}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>{node.name}</span>
          {menu}
        </div>
      </TreeItemLayout>
      <Tree>
        {(node.children ?? []).map((child) => (
          <FileTreeNode
            key={child.id}
            node={child}
            editing={editing}
            onSetEditing={onSetEditing}
            onOpenFile={onOpenFile}
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
