import { platform } from "node:os";

import type { Backend } from "./types";

export async function createBackend(): Promise<Backend> {
  switch (platform()) {
    case "linux": {
      const mod = await import("@openfuse/fuse");
      return await mod.createBackend();
    }
    case "darwin": {
      const mod = await import("@openfuse/fskit");
      return await mod.createBackend();
    }
    default:
      throw new Error(`openfuse: unsupported platform \"${platform()}\"`);
  }
}
