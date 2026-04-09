import { createContext, useContext, useEffect, useState, useCallback } from "react";

type Theme = "dark" | "light" | "system" | "auto";

interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: "dark" | "light";
}

const ThemeProviderContext = createContext<ThemeProviderState>({
  theme: "auto",
  setTheme: () => null,
  resolvedTheme: "dark",
});

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

function getAutoTheme(): "dark" | "light" {
  const hour = new Date().getHours();
  return (hour >= 7 && hour < 20) ? "light" : "dark";
}

function resolveTheme(theme: Theme): "dark" | "light" {
  if (theme === "auto") return getAutoTheme();
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function ThemeProvider({
  children,
  defaultTheme = "auto",
  storageKey = "ulysse-ui-theme",
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [resolvedTheme, setResolvedTheme] = useState<"dark" | "light">(() => resolveTheme(
    (localStorage.getItem(storageKey) as Theme) || defaultTheme
  ));

  const applyTheme = useCallback((t: Theme) => {
    const root = window.document.documentElement;
    const resolved = resolveTheme(t);
    root.classList.remove("light", "dark");
    root.classList.add(resolved);
    setResolvedTheme(resolved);
  }, []);

  useEffect(() => {
    applyTheme(theme);

    if (theme === "auto") {
      const interval = setInterval(() => {
        applyTheme("auto");
      }, 60_000);
      return () => clearInterval(interval);
    }
  }, [theme, applyTheme]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(storageKey, t);
    setThemeState(t);
  }, [storageKey]);

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
