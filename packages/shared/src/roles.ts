export const ORG_ROLES = ["owner", "agent", "viewer"] as const;

/**
 * - owner: manages the organization, billing and team.
 * - agent: a human sales rep; works conversations and leads.
 * - viewer: read-only access to the dashboard.
 */
export type OrgRole = (typeof ORG_ROLES)[number];

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}
