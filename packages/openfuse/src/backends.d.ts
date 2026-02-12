declare module "@openfuse/fuse" {
  import type { Backend } from "./types";

  export function createBackend(): Promise<Backend>;
}

declare module "@openfuse/fskit" {
  import type { Backend } from "./types";

  export function createBackend(): Promise<Backend>;
}
