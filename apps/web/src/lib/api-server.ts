import "server-only";
import type { LeadStatus, ListInventoryQuery, OrganizationSummary } from "@closer/shared";
import {
  agentListSchema,
  conversationDetailSchema,
  conversationPageSchema,
  documentListSchema,
  leadPageSchema,
  memberListSchema,
  inventoryPageSchema,
  meSchema,
  organizationListSchema,
} from "@closer/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ZodType } from "zod";
import { serverEnv } from "./server-env";

export type { OrganizationSummary };

/**
 * Server-side call to the API, forwarding the caller's cookies. The response is
 * validated, not cast: the API is a separate deployable and its contract can drift.
 * A 401 sends the user to /login; anything else unexpected reaches the error boundary.
 */
async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const result = await apiGetOptional(path, schema);
  if (result === null) throw new Error(`API ${path} failed with 404`);
  return result;
}

/** Like `apiGet`, but a 404 (deleted, or another org's id in the URL) is `null`. */
async function apiGetOptional<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}

export const getMe = () => apiGet("/api/me", meSchema);

// Deduplicated per request: the dashboard layout and its pages both need it.
export const getOrganizations = cache(
  async () => (await apiGet("/api/organizations", organizationListSchema)).organizations,
);

type InventoryQuery = { [K in keyof ListInventoryQuery]?: ListInventoryQuery[K] | undefined };

export function getInventory(orgId: string, query: InventoryQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries<string | number | undefined>(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return apiGet(
    `/api/organizations/${encodeURIComponent(orgId)}/inventory?${params}`,
    inventoryPageSchema,
  );
}

export const getDocuments = async (orgId: string) =>
  (await apiGet(`/api/organizations/${encodeURIComponent(orgId)}/documents`, documentListSchema))
    .documents;

export const getAgents = async (orgId: string) =>
  (await apiGet(`/api/organizations/${encodeURIComponent(orgId)}/agents`, agentListSchema)).agents;

export const getConversations = (orgId: string, query: { limit: number; offset: number }) =>
  apiGet(
    `/api/organizations/${encodeURIComponent(orgId)}/conversations?limit=${query.limit}&offset=${query.offset}`,
    conversationPageSchema,
  );

export const getConversation = async (orgId: string, conversationId: string) =>
  (
    await apiGetOptional(
      `/api/organizations/${encodeURIComponent(orgId)}/conversations/${encodeURIComponent(conversationId)}`,
      conversationDetailSchema,
    )
  )?.conversation ?? null;

export const getLeads = (
  orgId: string,
  query: { status?: LeadStatus; limit: number; offset: number },
) => {
  const params = new URLSearchParams({ limit: String(query.limit), offset: String(query.offset) });
  if (query.status) params.set("status", query.status);
  return apiGet(`/api/organizations/${encodeURIComponent(orgId)}/leads?${params}`, leadPageSchema);
};

export const getMembers = async (orgId: string) =>
  (await apiGet(`/api/organizations/${encodeURIComponent(orgId)}/members`, memberListSchema))
    .members;
