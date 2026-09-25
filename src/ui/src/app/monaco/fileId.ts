import type * as monaco from "monaco-editor"

// The project workspace on the backend is keyed by file id, and @monaco-editor/react
// builds each model's URI from the `path` prop, which EditorArea sets to the file id.
export function fileIdOf(model: monaco.editor.ITextModel): string {
  return model.uri.path.replace(/^\//, "")
}
