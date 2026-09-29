import "server-only";
import type { OrgRole } from "@closer/shared";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { serverEnv } from "./server-env";

export type Me = {
  user: { id: string; name: string; email: string; emailVerified: boolean; image: string | null };
};
export type OrganizationSummary = { id: string; name: string; slug: string; role: OrgRole };

/**
 * Server-side call to the API, forwarding the caller's cookies. A 401 sends the user to
 * /login; any other non-2xx is an unexpected failure and bubbles up to the error boundary.
 */
async function apiGet<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${serverEnv.API_INTERNAL_URL}${path}`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export const getMe = () => apiGet<Me>("/api/me");

export const getOrganizations = async () =>
  (await apiGet<{ organizations: OrganizationSummary[] }>("/api/organizations")).organizations;
