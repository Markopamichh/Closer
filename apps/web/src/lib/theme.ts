export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Same key next-themes used, so existing visitors keep their choice. */
export const THEME_STORAGE_KEY = "theme";

export const parseTheme = (stored: string | null): Theme =>
  THEMES.find((theme) => theme === stored) ?? "system";

export const isDark = (theme: Theme, prefersDark: boolean) =>
  theme === "dark" || (theme === "system" && prefersDark);

/**
 * Runs in <head> before first paint so a dark-mode visitor never sees a light flash.
 * Rendered by the server layout: React 19 refuses to run scripts rendered by client
 * components (the warning next-themes triggered). Mirrors parseTheme + isDark.
 */
export const themeScript = () =>
  `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t!=="light"&&t!=="dark")t="system";` +
  `var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);` +
  `document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
