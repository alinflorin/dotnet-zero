import { useEffect } from "react"
import { ThemeProvider } from "./app/theme/ThemeProvider"
import { ProjectProvider } from "./app/project/ProjectProvider"
import { LogProvider } from "./app/panel/LogProvider"
import { Shell } from "./components/shell/Shell"
import { ensureBlazorReady } from "./app/blazor/blazorReady"
import "./app/i18n/i18n"

function App() {
  useEffect(() => {
    void ensureBlazorReady()
  }, [])

  return (
    <ThemeProvider>
      <ProjectProvider>
        <LogProvider>
          <Shell />
        </LogProvider>
      </ProjectProvider>
    </ThemeProvider>
  )
}

export default App
