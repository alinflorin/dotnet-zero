import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"
import EditorWorker from "monaco-editor/editor/editor.worker?worker"
import { registerCSharpLanguageFeatures } from "./language"

// This IDE only ever edits C# source, so the editor worker is the only one
// registered — Monaco's JSON/CSS/HTML/TypeScript workers are never used.
self.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker()
  },
}

loader.config({ monaco })

// Registers completion/hover/diagnostics providers. Safe to call before Blazor has
// started — each provider awaits WASM readiness itself before calling into .NET.
registerCSharpLanguageFeatures()

export { CSHARP_LANGUAGE_ID } from "./language"
