import { useEffect } from "react"
import { ThemeProvider } from "./app/theme/ThemeProvider"
import { Shell } from "./components/shell/Shell"
import "./app/i18n/i18n"

function App() {
  useEffect(() => {
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (window as any).Blazor.start();
    })();
  }, []);

  return (
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  )
}

export default App
