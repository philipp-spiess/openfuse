import { createBackend as createPlatformBackend } from "./platform";
import type { Backend, FileSystem, FileSystemHandlers } from "./types";

export * from "./errors";
export * from "./types";

export interface CreateFileSystemOptions {
  backend?: Backend;
  createBackend?: () => Promise<Backend>;
}

export function createFileSystem(
  handlers: FileSystemHandlers,
  options: CreateFileSystemOptions = {},
): FileSystem {
  let backend: Backend | null = options.backend ?? null;
  let mounted = false;
  let currentMountPoint: string | null = null;

  return {
    async mount(mountPoint: string): Promise<void> {
      if (mounted) {
        throw new Error(`openfuse: filesystem is already mounted at \"${currentMountPoint}\"`);
      }

      if (!backend) {
        backend = options.createBackend
          ? await options.createBackend()
          : await createPlatformBackend();
      }

      await backend.mount(mountPoint, handlers);
      mounted = true;
      currentMountPoint = mountPoint;
    },

    async unmount(): Promise<void> {
      if (!mounted || !backend) {
        return;
      }

      await backend.unmount();
      mounted = false;
      currentMountPoint = null;
    },

    get mounted(): boolean {
      return mounted;
    },

    get mountPoint(): string | null {
      return currentMountPoint;
    },
  };
}
