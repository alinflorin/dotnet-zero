import * as monaco from "monaco-editor"
import { invokeDotNet } from "../../hooks/useDotNet"
import { ensureBlazorReady } from "../blazor/blazorReady"
import { fileIdOf } from "./fileId"

export const CSHARP_LANGUAGE_ID = "csharp"

const DIAGNOSTICS_OWNER = "roslyn"
const DIAGNOSTICS_DEBOUNCE_MS = 400

interface CompletionItemDto {
  label: string
  kind: string
  insertText: string
}

interface HoverDto {
  markdownText: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

interface SignatureParameterDto {
  startOffset: number
  endOffset: number
  documentation: string | null
}

interface SignatureItemDto {
  label: string
  documentation: string | null
  parameters: SignatureParameterDto[]
}

interface SignatureHelpDto {
  signatures: SignatureItemDto[]
  activeSignature: number
  activeParameter: number
}

interface LiveDiagnosticDto {
  severity: string
  message: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

const COMPLETION_KIND_MAP: Record<string, monaco.languages.CompletionItemKind> = {
  Class: monaco.languages.CompletionItemKind.Class,
  Structure: monaco.languages.CompletionItemKind.Struct,
  Interface: monaco.languages.CompletionItemKind.Interface,
  Enum: monaco.languages.CompletionItemKind.Enum,
  EnumMember: monaco.languages.CompletionItemKind.EnumMember,
  Delegate: monaco.languages.CompletionItemKind.Function,
  Method: monaco.languages.CompletionItemKind.Method,
  ExtensionMethod: monaco.languages.CompletionItemKind.Method,
  Property: monaco.languages.CompletionItemKind.Property,
  Field: monaco.languages.CompletionItemKind.Field,
  Event: monaco.languages.CompletionItemKind.Event,
  Local: monaco.languages.CompletionItemKind.Variable,
  Parameter: monaco.languages.CompletionItemKind.Variable,
  Namespace: monaco.languages.CompletionItemKind.Module,
  Keyword: monaco.languages.CompletionItemKind.Keyword,
  Constant: monaco.languages.CompletionItemKind.Constant,
  Operator: monaco.languages.CompletionItemKind.Operator,
  TypeParameter: monaco.languages.CompletionItemKind.TypeParameter,
  Snippet: monaco.languages.CompletionItemKind.Snippet,
}

function toCompletionKind(tag: string): monaco.languages.CompletionItemKind {
  return COMPLETION_KIND_MAP[tag] ?? monaco.languages.CompletionItemKind.Text
}

function toMarkerSeverity(severity: string): monaco.MarkerSeverity {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error
    case "warning":
      return monaco.MarkerSeverity.Warning
    case "info":
      return monaco.MarkerSeverity.Info
    default:
      return monaco.MarkerSeverity.Hint
  }
}

let registered = false

export function registerCSharpLanguageFeatures() {
  if (registered) return
  registered = true

  monaco.languages.registerCompletionItemProvider(CSHARP_LANGUAGE_ID, {
    triggerCharacters: [".", " ", "(", "<", "["],
    async provideCompletionItems(model, position, context) {
      // Monaco can request completions before the WASM runtime has finished starting up
      // (e.g. right after page load) — wait for it instead of failing the request.
      await ensureBlazorReady()

      const word = model.getWordUntilPosition(position)
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)

      try {
        const items = await invokeDotNet<CompletionItemDto[]>(
          "GetCompletions",
          fileIdOf(model),
          model.getValue(),
          model.getOffsetAt(position),
          context.triggerCharacter ?? null,
        )
        return {
          suggestions: items.map((item) => ({
            label: item.label,
            kind: toCompletionKind(item.kind),
            insertText: item.insertText,
            range,
          })),
        }
      } catch {
        return { suggestions: [] }
      }
    },
  })

  monaco.languages.registerHoverProvider(CSHARP_LANGUAGE_ID, {
    async provideHover(model, position) {
      await ensureBlazorReady()

      try {
        const hover = await invokeDotNet<HoverDto | null>(
          "GetHover",
          fileIdOf(model),
          model.getValue(),
          model.getOffsetAt(position),
        )
        if (!hover) return null
        return {
          contents: [{ value: hover.markdownText }],
          range: new monaco.Range(hover.startLine, hover.startColumn, hover.endLine, hover.endColumn),
        }
      } catch {
        return null
      }
    },
  })

  monaco.languages.registerSignatureHelpProvider(CSHARP_LANGUAGE_ID, {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [")"],
    async provideSignatureHelp(model, position, _token, context) {
      await ensureBlazorReady()

      try {
        const help = await invokeDotNet<SignatureHelpDto | null>(
          "GetSignatureHelp",
          fileIdOf(model),
          model.getValue(),
          model.getOffsetAt(position),
          context.triggerCharacter ?? null,
          context.isRetrigger,
        )
        if (!help || help.signatures.length === 0) return null

        return {
          value: {
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              documentation: signature.documentation ? { value: signature.documentation } : undefined,
              parameters: signature.parameters.map((parameter) => ({
                label: [parameter.startOffset, parameter.endOffset] as [number, number],
                documentation: parameter.documentation ? { value: parameter.documentation } : undefined,
              })),
            })),
            activeSignature: help.activeSignature,
            activeParameter: help.activeParameter,
          },
          dispose: () => {},
        }
      } catch {
        return null
      }
    },
  })

  const diagnosticsTimers = new Map<string, ReturnType<typeof setTimeout>>()

  async function updateDiagnostics(model: monaco.editor.ITextModel) {
    await ensureBlazorReady()
    if (model.isDisposed()) return

    try {
      const diagnostics = await invokeDotNet<LiveDiagnosticDto[]>("GetLiveDiagnostics", fileIdOf(model), model.getValue())
      if (model.isDisposed()) return
      monaco.editor.setModelMarkers(
        model,
        DIAGNOSTICS_OWNER,
        diagnostics.map((d) => ({
          severity: toMarkerSeverity(d.severity),
          message: d.message,
          startLineNumber: d.startLine,
          startColumn: d.startColumn,
          endLineNumber: d.endLine,
          endColumn: d.endColumn,
        })),
      )
    } catch {
      // Transient failure (e.g. file removed mid-request) — the next edit retries.
    }
  }

  function scheduleDiagnostics(model: monaco.editor.ITextModel) {
    const key = model.uri.toString()
    const existing = diagnosticsTimers.get(key)
    if (existing) clearTimeout(existing)
    diagnosticsTimers.set(
      key,
      setTimeout(() => {
        diagnosticsTimers.delete(key)
        void updateDiagnostics(model)
      }, DIAGNOSTICS_DEBOUNCE_MS),
    )
  }

  monaco.editor.onDidCreateModel((model) => {
    if (model.getLanguageId() !== CSHARP_LANGUAGE_ID) return
    scheduleDiagnostics(model)
    const changeListener = model.onDidChangeContent(() => scheduleDiagnostics(model))
    model.onWillDispose(() => {
      changeListener.dispose()
      const key = model.uri.toString()
      const timer = diagnosticsTimers.get(key)
      if (timer) {
        clearTimeout(timer)
        diagnosticsTimers.delete(key)
      }
    })
  })
}
