import { z } from "zod";
import { ORG_ROLES } from "./roles";

export const LEAD_STATUSES = [
  "new",
  "qualified",
  "contacted",
  "visit_scheduled",
  "won",
  "lost",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const listLeadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

/** What the team changes on a lead. Contact details come from the customer, via the agent. */
export const updateLeadSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
    /** A member of the org, or null to unassign. */
    assignedTo: z.uuid().nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const leadSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  /** What they are looking for, in the agent's words. */
  interest: z.string().nullable(),
  /** 0–100, the agent's estimate of how ready they are to buy. */
  score: z.number().int(),
  status: z.enum(LEAD_STATUSES),
  assignee: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** Latest conversation with this lead, to read what was said. */
  conversationId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type LeadDto = z.infer<typeof leadSchema>;

export const leadPageSchema = z.object({
  leads: z.array(leadSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type LeadPage = z.infer<typeof leadPageSchema>;
export const leadResponseSchema = z.object({ lead: leadSchema });

export const memberSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ORG_ROLES),
});
export type MemberDto = z.infer<typeof memberSchema>;
export const memberListSchema = z.object({ members: z.array(memberSchema) });
