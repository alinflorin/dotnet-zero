import { useCallback, useEffect, useRef } from "react"
import Editor, { type Monaco, type OnMount } from "@monaco-editor/react"
import type { editor as MonacoEditor } from "monaco-editor"
import { makeStyles, tokens, Text } from "@fluentui/react-components"
import { useTranslation } from "react-i18next"
import { useThemeMode } from "../../app/theme/theme-context"
import { useProject } from "../../app/project/project-context"
import { useDebug } from "../../app/debug/debug-context"
import { CSHARP_LANGUAGE_ID } from "../../app/monaco/setup"
import { fileIdOf } from "../../app/monaco/fileId"
import { EditorTabs, type EditorFile } from "./EditorTabs"

const BREAKPOINT_GLYPH_CLASS = "zero-breakpoint-glyph"
const CURRENT_LINE_CLASS = "zero-debug-current-line"

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
  const { breakpoints, toggleBreakpoint, callStack, status } = useDebug()

  const activeFile = openFiles.find((file) => file.id === activeFileId) ?? null

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const breakpointDecorationsRef = useRef<Map<string, string[]>>(new Map())
  const currentLineDecorationRef = useRef<string[]>([])

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor
      monacoRef.current = monaco
      editor.onMouseDown((e) => {
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return
        const model = editor.getModel()
        if (!model) return
        toggleBreakpoint(fileIdOf(model), e.target.position.lineNumber)
      })
    },
    [toggleBreakpoint],
  )

  const tabs: EditorFile[] = openFiles.map((file) => ({
    id: file.id,
    name: file.name,
    language: CSHARP_LANGUAGE_ID,
    isDirty: dirtyFileIds.has(file.id),
  }))

  // Breakpoint gutter dots for whichever file is currently shown. Decorations live on the
  // model (not the editor), so a background file's dots persist even while it's not visible.
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco || !activeFile) return
    const model = editor.getModel()
    if (!model) return

    const lines = breakpoints[fileIdOf(model)] ?? []
    const decorations: MonacoEditor.IModelDeltaDecoration[] = lines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: { glyphMarginClassName: BREAKPOINT_GLYPH_CLASS, glyphMarginHoverMessage: { value: "Breakpoint" } },
    }))

    const key = model.uri.toString()
    const oldIds = breakpointDecorationsRef.current.get(key) ?? []
    const newIds = model.deltaDecorations(oldIds, decorations)
    breakpointDecorationsRef.current.set(key, newIds)
  }, [breakpoints, activeFile])

  // Highlights the line the debuggee is currently paused on, when that's the active file.
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!editor || !monaco || !model) return

    const topFrame = callStack[0]
    const showsCurrentLine = status === "paused" && topFrame && fileIdOf(model) === topFrame.fileId

    if (!showsCurrentLine) {
      currentLineDecorationRef.current = model.deltaDecorations(currentLineDecorationRef.current, [])
      return
    }

    currentLineDecorationRef.current = model.deltaDecorations(currentLineDecorationRef.current, [
      { range: new monaco.Range(topFrame.line, 1, topFrame.line, 1), options: { isWholeLine: true, className: CURRENT_LINE_CLASS } },
    ])
    editor.revealLineInCenter(topFrame.line)
  }, [callStack, status, activeFile])

  // Jump to the paused frame's file automatically, when it's already open.
  useEffect(() => {
    if (status !== "paused") return
    const topFrame = callStack[0]
    if (!topFrame || topFrame.fileId === activeFileId) return
    if (openFiles.some((f) => f.id === topFrame.fileId)) setActiveFile(topFrame.fileId)
  }, [status, callStack, activeFileId, openFiles, setActiveFile])

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
            onMount={handleMount}
            theme={resolvedMode === "dark" ? "vs-dark" : "light"}
            options={{
              fontSize: 13,
              minimap: { enabled: true },
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              glyphMargin: true,
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
