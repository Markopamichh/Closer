import type { LucideIcon } from "lucide-react";
import { Bot, BookOpen, MessagesSquare, Package, Settings, UserRound } from "lucide-react";

export type NavItem = { segment: string; label: string; icon: LucideIcon; description: string };

export const NAV_ITEMS: NavItem[] = [
  {
    segment: "conversations",
    label: "Conversations",
    icon: MessagesSquare,
    description: "Live and past chats between your AI agent and visitors.",
  },
  {
    segment: "leads",
    label: "Leads",
    icon: UserRound,
    description: "Qualified prospects, their score and who is following up.",
  },
  {
    segment: "inventory",
    label: "Inventory",
    icon: Package,
    description: "The vehicles, properties or products your agent can talk about.",
  },
  {
    segment: "knowledge",
    label: "Knowledge",
    icon: BookOpen,
    description: "Documents the agent uses to answer questions accurately.",
  },
  {
    segment: "agent",
    label: "Agent",
    icon: Bot,
    description: "Personality, tone and rules of your AI sales agent.",
  },
  {
    segment: "settings",
    label: "Settings",
    icon: Settings,
    description: "Organization details, team members and billing.",
  },
];

export function navItem(segment: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.segment === segment);
  if (!item) throw new Error(`Unknown dashboard section: ${segment}`);
  return item;
}
