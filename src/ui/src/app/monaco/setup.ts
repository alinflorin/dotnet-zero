import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"

// This IDE only ever edits C# source, so the editor worker is the only one
// registered — Monaco's JSON/CSS/HTML/TypeScript workers are never used.
self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker()
  },
}

loader.config({ monaco })

export const CSHARP_LANGUAGE_ID = "csharp"
