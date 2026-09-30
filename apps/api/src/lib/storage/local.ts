import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { FileStorage } from "./types";
import { assertValidKey, StorageNotFoundError } from "./types";

/** Filesystem storage for local development and tests. */
export function createLocalStorage(rootDir: string): FileStorage {
  const root = resolve(rootDir);
  const pathFor = (key: string) => {
    assertValidKey(key);
    return join(root, key);
  };

  return {
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathFor(key)));
      } catch (err) {
        if (err instanceof Error && "code" in err && err.code === "ENOENT") {
          throw new StorageNotFoundError(key);
        }
        throw err;
      }
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}
