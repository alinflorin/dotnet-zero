import { useState } from "react"
import Editor from "@monaco-editor/react"
import { makeStyles, tokens, Text } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { useThemeMode } from "../../app/theme/theme-context"
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

const initialFiles: (EditorFile & { content: string })[] = [
  {
    id: "program",
    name: "Program.cs",
    language: CSHARP_LANGUAGE_ID,
    content: [
      "// Welcome to Zero",
      "Console.WriteLine(\"Hello, Zero!\");",
      "",
    ].join("\n"),
  },
]

export function EditorArea() {
  const styles = useStyles()
  const { t } = useTranslation()
  const { resolvedMode } = useThemeMode()
  const [files, setFiles] = useState(initialFiles)
  const [activeId, setActiveId] = useState<string | null>(initialFiles[0]?.id ?? null)

  const activeFile = files.find((file) => file.id === activeId) ?? null

  const handleClose = (id: string) => {
    setFiles((prev) => {
      const next = prev.filter((file) => file.id !== id)
      if (activeId === id) {
        setActiveId(next[next.length - 1]?.id ?? null)
      }
      return next
    })
  }

  return (
    <div className={styles.root}>
      <EditorTabs files={files} activeId={activeId} onSelect={setActiveId} onClose={handleClose} />
      {activeFile ? (
        <div className={styles.editorHost}>
          <Editor
            path={activeFile.id}
            defaultLanguage={activeFile.language}
            defaultValue={activeFile.content}
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
