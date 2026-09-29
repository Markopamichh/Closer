import { z } from "zod";
import { ORG_ROLES } from "./roles";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(80),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const inviteMemberSchema = z.object({
  email: z.email().trim().toLowerCase(),
  // Ownership is never granted by invitation; it is transferred explicitly.
  role: z.enum(ORG_ROLES).exclude(["owner"]),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

export const orgIdParamSchema = z.object({
  orgId: z.uuid(),
});

// Response shapes, validated by the web app when reading from the API.

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: z.enum(ORG_ROLES),
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

export const organizationListSchema = z.object({
  organizations: z.array(organizationSummarySchema),
});

export const createdOrganizationSchema = organizationSummarySchema;

export const meSchema = z.object({
  user: z.object({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
  }),
  activeOrganizationId: z.uuid().nullable(),
});
export type Me = z.infer<typeof meSchema>;
