import "server-only";
import { z } from "zod";

const schema = z.object({
  /** Where the web server reaches the API directly (never exposed to the browser). */
  API_INTERNAL_URL: z.url().default("http://localhost:4000"),
});

export const serverEnv = schema.parse(process.env);
