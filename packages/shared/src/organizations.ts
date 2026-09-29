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
