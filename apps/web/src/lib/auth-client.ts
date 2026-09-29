import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// Same-origin: requests go to /api/auth/* and are proxied to the API by next.config.ts.
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [organizationClient()],
});
