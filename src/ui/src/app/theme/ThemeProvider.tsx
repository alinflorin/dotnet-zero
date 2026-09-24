import {
  FluentProvider,
  teamsLightTheme,
  teamsDarkTheme,
  type Theme,
} from "@fluentui/react-components"
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { ThemeContext, type ThemeContextValue, type ThemeMode } from "./theme-context"

const STORAGE_KEY = "zero.themeMode"

function getSystemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function readStoredMode(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "light" || stored === "dark" || stored === "auto") {
    return stored
  }
  return "auto"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode)
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    mediaQuery.addEventListener("change", handleChange)
    return () => mediaQuery.removeEventListener("change", handleChange)
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }, [])

  const resolvedMode: "light" | "dark" = mode === "auto" ? (systemPrefersDark ? "dark" : "light") : mode

  const theme: Theme = resolvedMode === "dark" ? teamsDarkTheme : teamsLightTheme

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedMode
  }, [resolvedMode])

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolvedMode, setMode }),
    [mode, resolvedMode, setMode],
  )

  return (
    <ThemeContext.Provider value={value}>
      <FluentProvider theme={theme} style={{ height: "100%" }}>
        {children}
      </FluentProvider>
    </ThemeContext.Provider>
  )
}
