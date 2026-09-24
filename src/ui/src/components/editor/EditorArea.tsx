import Editor from "@monaco-editor/react"
import { makeStyles, tokens, Text } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { useThemeMode } from "../../app/theme/theme-context"
import { useProject } from "../../app/project/project-context"
import { CSHARP_LANGUAGE_ID } from "../../app/monaco/setup"
import { EditorTabs, type EditorFile } from "./EditorTabs"

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  editorHost: {
    flexGrow: 1,
    minHeight: 0,
  },
  empty: {
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: tokens.colorNeutralForeground3,
  },
})

export function EditorArea() {
  const styles = useStyles()
  const { t } = useTranslation()
  const { resolvedMode } = useThemeMode()
  const { openFiles, activeFileId, dirtyFileIds, setActiveFile, closeFile, updateFileContent } = useProject()

  const activeFile = openFiles.find((file) => file.id === activeFileId) ?? null

  const tabs: EditorFile[] = openFiles.map((file) => ({
    id: file.id,
    name: file.name,
    language: CSHARP_LANGUAGE_ID,
    isDirty: dirtyFileIds.has(file.id),
  }))

  return (
    <div className={styles.root}>
      <EditorTabs files={tabs} activeId={activeFileId} onSelect={setActiveFile} onClose={closeFile} />
      {activeFile ? (
        <div className={styles.editorHost}>
          <Editor
            path={activeFile.id}
            defaultLanguage={CSHARP_LANGUAGE_ID}
            value={activeFile.content}
            onChange={(value) => updateFileContent(activeFile.id, value ?? "")}
            theme={resolvedMode === "dark" ? "vs-dark" : "light"}
            options={{
              fontSize: 13,
              minimap: { enabled: true },
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
            }}
          />
        </div>
      ) : (
        <div className={styles.empty}>
          <Text className={styles.emptyText}>{t("editor.noFile")}</Text>
        </div>
      )}
    </div>
  )
}
