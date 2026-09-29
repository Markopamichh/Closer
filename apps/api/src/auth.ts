import type { Db } from "@closer/db";
import {
  accounts,
  invitations,
  memberships,
  organizations,
  sessions,
  users,
  verifications,
} from "@closer/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";
import type { Env } from "./env";
import type { Logger } from "./lib/logger";

/**
 * Permissions Better Auth enforces on its own organization endpoints. They mirror the
 * checks our routes do with `requireRole`, so both paths agree on who can do what.
 */
const ac = createAccessControl(defaultStatements);
const roles = {
  owner: ownerAc,
  agent: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: ["read"] }),
  viewer: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: ["read"] }),
};

const INVITATION_TTL_SECONDS = 60 * 60 * 24 * 7;

export function createAuth(deps: {
  db: Db;
  env: Pick<Env, "BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "WEB_ORIGIN">;
  logger: Logger;
}) {
  const { db, env, logger } = deps;

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { users, sessions, accounts, verifications, organizations, memberships, invitations },
    }),
    user: { modelName: "users" },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      // Sign-in is allowed before verifying so onboarding works without an email provider.
      // Joining another org is not: see requireEmailVerificationOnInvitation below.
      requireEmailVerification: false,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      // No email provider yet: surface the link in the logs so it can be used locally.
      sendVerificationEmail: async ({ user, url }) => {
        logger.info({ userId: user.id, verifyUrl: url }, "email verification requested");
        await Promise.resolve();
      },
    },
    advanced: {
      cookiePrefix: "closer",
      database: { generateId: "uuid" },
      // Requests arrive through the web app's /api proxy; the client IP is forwarded there.
      ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
        // Without this, anyone could register an unverified account with an invitee's
        // email address and accept the invitation in their place.
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: INVITATION_TTL_SECONDS,
        schema: {
          organization: { modelName: "organizations" },
          member: { modelName: "memberships", fields: { organizationId: "orgId" } },
          invitation: { modelName: "invitations", fields: { organizationId: "orgId" } },
        },
        // No email provider yet: surface the link in the logs so it can be used locally.
        sendInvitationEmail: async ({ id, organization: org, role }) => {
          const acceptUrl = `${env.WEB_ORIGIN}/accept-invitation/${id}`;
          logger.info({ invitationId: id, orgId: org.id, role, acceptUrl }, "invitation created");
          await Promise.resolve();
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
