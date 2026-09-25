import { useEffect } from "react"
import { ThemeProvider } from "./app/theme/ThemeProvider"
import { ProjectProvider } from "./app/project/ProjectProvider"
import { LogProvider } from "./app/panel/LogProvider"
import { DebugProvider } from "./app/debug/DebugProvider"
import { Shell } from "./components/shell/Shell"
import { PwaPrompt } from "./app/pwa/PwaPrompt"
import { ensureBlazorReady } from "./app/blazor/blazorReady"
import "./app/i18n/i18n"

function App() {
  useEffect(() => {
    void ensureBlazorReady()
  }, []);

  return (
    <ThemeProvider>
      <ProjectProvider>
        <LogProvider>
          <DebugProvider>
            <Shell />
            <PwaPrompt />
          </DebugProvider>
        </LogProvider>
      </ProjectProvider>
    </ThemeProvider>
  )
}

export default App
