import { createContext, useContext } from "react"

export type ThemeMode = "light" | "dark" | "auto"

export interface ThemeContextValue {
  mode: ThemeMode
  resolvedMode: "light" | "dark"
  setMode: (mode: ThemeMode) => void
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useThemeMode must be used within a ThemeProvider")
  }
  return context
}
