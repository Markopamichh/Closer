import type { LucideIcon } from "lucide-react";
import { Bot, BookOpen, MessagesSquare, Package, Settings, UserRound } from "lucide-react";

// Labels and descriptions live in the `nav.<segment>` translation keys.
export const NAV_ITEMS = [
  { segment: "conversations", icon: MessagesSquare },
  { segment: "leads", icon: UserRound },
  { segment: "inventory", icon: Package },
  { segment: "knowledge", icon: BookOpen },
  { segment: "agent", icon: Bot },
  { segment: "settings", icon: Settings },
] as const satisfies readonly { segment: string; icon: LucideIcon }[];

export type NavSegment = (typeof NAV_ITEMS)[number]["segment"];

export function navItem(segment: NavSegment) {
  const item = NAV_ITEMS.find((i) => i.segment === segment);
  if (!item) throw new Error(`Unknown dashboard section: ${segment}`);
  return item;
}
