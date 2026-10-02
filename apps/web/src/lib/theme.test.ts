import { describe, expect, it } from "vitest";
import { isDark, parseTheme, THEME_STORAGE_KEY, themeScript } from "./theme";

/** Runs the inline script against fake browser globals; returns whether it set "dark". */
function runScript(stored: string | null, prefersDark: boolean) {
  const classes = new Set<string>();
  const html = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    style: { colorScheme: "" },
  };
  // Evaluating the exact inline text is the point: it must match the TypeScript logic.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("localStorage", "matchMedia", "document", themeScript()) as (
    ...args: unknown[]
  ) => void;
  run(
    { getItem: (key: string) => (key === THEME_STORAGE_KEY ? stored : null) },
    () => ({ matches: prefersDark }),
    { documentElement: html },
  );
  return classes.has("dark");
}

describe("theme", () => {
  it("defaults anything unknown to system", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("purple")).toBe("system");
    expect(parseTheme("dark")).toBe("dark");
  });

  it("the inline script decides exactly like parseTheme + isDark", () => {
    for (const stored of [null, "light", "dark", "system", "garbage"]) {
      for (const prefersDark of [true, false]) {
        expect(runScript(stored, prefersDark)).toBe(isDark(parseTheme(stored), prefersDark));
      }
    }
  });
});
