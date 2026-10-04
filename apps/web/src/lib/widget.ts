import type { WidgetConfig } from "@closer/shared";
import { widgetConfigSchema, widgetPublicKeySchema } from "@closer/shared";

/** Only plain origins reach the header; anything else (should the API drift) is dropped. */
const ORIGIN = /^https?:\/\/([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$/;

/**
 * CSP for the embed page: framable by the business's own sites (and 'self', so the
 * dashboard can preview it), nowhere else. The browser enforces it, not our code.
 */
export function frameAncestors(origins: readonly string[]): string {
  const allowed = origins.filter((origin) => ORIGIN.test(origin));
  return ["frame-ancestors", "'self'", ...allowed].join(" ");
}

/** Public widget config, or null for an unknown, malformed or disabled key. */
export async function fetchWidgetConfig(
  apiUrl: string,
  publicKey: string,
): Promise<WidgetConfig | null> {
  if (!widgetPublicKeySchema.safeParse(publicKey).success) return null;
  const res = await fetch(`${apiUrl}/api/public/widget/${publicKey}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Widget config failed with ${res.status}`);
  return widgetConfigSchema.parse(await res.json());
}
