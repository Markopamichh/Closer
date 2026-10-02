"use client";

import type { ReactNode } from "react";
import { createContext, use, useCallback, useEffect, useSyncExternalStore } from "react";
import type { Theme } from "@/lib/theme";
import { isDark, parseTheme, THEME_STORAGE_KEY } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CHANGE_EVENT = "closer:theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);

// localStorage is the store: other tabs fire "storage", this tab fires CHANGE_EVENT.
function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
const readTheme = () => parseTheme(localStorage.getItem(THEME_STORAGE_KEY));
const serverTheme = (): Theme => "system";

function apply(theme: Theme) {
  const dark = isDark(theme, window.matchMedia(DARK_QUERY).matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** The first paint is themed by the inline script in the root layout; this keeps it in sync. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);

  useEffect(() => {
    apply(theme);
    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const follow = () => {
      apply("system");
    };
    media.addEventListener("change", follow);
    return () => {
      media.removeEventListener("change", follow);
    };
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>;
}

export function useTheme() {
  const context = use(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
