declare global {
  interface Window {
    Blazor: {
      start: () => Promise<void>
    }
  }
}

let readyPromise: Promise<void> | null = null

export function ensureBlazorReady(): Promise<void> {
  readyPromise ??= window.Blazor.start()
  return readyPromise
}
