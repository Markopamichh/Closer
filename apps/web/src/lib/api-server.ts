import "server-only";
import type { OrganizationSummary } from "@closer/shared";
import { meSchema, organizationListSchema } from "@closer/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { serverEnv } from "./server-env";

export type { OrganizationSummary };

/**
 * Server-side call to the API, forwarding the caller's cookies. The response is
 * validated, not cast: the API is a separate deployable and its contract can drift.
 * A 401 sends the user to /login; anything else unexpected reaches the error boundary.
 */
async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}

export const getMe = () => apiGet("/api/me", meSchema);

export const getOrganizations = async () =>
  (await apiGet("/api/organizations", organizationListSchema)).organizations;
