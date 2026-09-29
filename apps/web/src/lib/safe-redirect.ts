/** Only same-origin relative paths; blocks open redirects like `//evil.com` or `https://…`. */
export function safeNextPath(value: string | string[] | undefined, fallback = "/select-org") {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
