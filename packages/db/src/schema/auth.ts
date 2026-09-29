import { boolean, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { appOnlyPolicy, id, timestamps } from "./_shared";
import { orgRoleEnum } from "./enums";

// Tables below are owned by Better Auth (core + organization plugin). Property names
// must match Better Auth's field names; see apps/api/src/auth.ts for the model mapping.

export const users = pgTable(
  "users",
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    ...timestamps,
  },
  () => [appOnlyPolicy()],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    activeOrganizationId: uuid().references(() => organizations.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    index("sessions_active_org_id_idx").on(t.activeOrganizationId),
    appOnlyPolicy(),
  ],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    ...timestamps,
  },
  (t) => [index("accounts_user_id_idx").on(t.userId), appOnlyPolicy()],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier), appOnlyPolicy()],
);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text().notNull(),
    slug: text().notNull().unique(),
    logo: text(),
    metadata: text(),
    ...timestamps,
  },
  () => [appOnlyPolicy()],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRoleEnum().notNull().default("viewer"),
    ...timestamps,
  },
  (t) => [
    unique("memberships_org_user_unique").on(t.orgId, t.userId),
    index("memberships_user_id_idx").on(t.userId),
    appOnlyPolicy(),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text().notNull(),
    role: orgRoleEnum().notNull().default("viewer"),
    status: text().notNull().default("pending"),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    inviterId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    index("invitations_org_id_idx").on(t.orgId),
    index("invitations_email_idx").on(t.email),
    index("invitations_inviter_id_idx").on(t.inviterId),
    appOnlyPolicy(),
  ],
);
