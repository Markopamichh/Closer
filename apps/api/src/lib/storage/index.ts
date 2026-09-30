import type { Env } from "../../env";
import { createLocalStorage } from "./local";
import { createSupabaseStorage } from "./supabase";
import type { FileStorage } from "./types";

export * from "./types";

export function createStorage(env: Env): FileStorage {
  if (env.STORAGE_DRIVER === "supabase") {
    return createSupabaseStorage({
      url: env.SUPABASE_URL ?? "",
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      bucket: env.STORAGE_BUCKET,
    });
  }
  return createLocalStorage(env.LOCAL_STORAGE_DIR);
}
