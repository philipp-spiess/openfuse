import type { Backend, FileSystemHandlers } from "./index";

class NodeFallbackBackend implements Backend {
  private mounted = false;
  private mountPoint: string | null = null;
  private handlers: FileSystemHandlers | null = null;

  async mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void> {
    if (this.mounted) {
      throw new Error(`openfuse/fuse: already mounted at \"${this.mountPoint}\"`);
    }

    handlers.activate();

    let fuseNative: unknown;

    try {
      const mod = await import("fuse-native");
      fuseNative = mod.default ?? mod;
    } catch {
      handlers.deactivate();
      throw new Error(
        "openfuse/fuse: fuse-native is not installed. Install it to use the Node.js fallback backend.",
      );
    }

    void fuseNative;

    handlers.deactivate();
    throw new Error(
      "openfuse/fuse: Node fallback is scaffolded but fuse-native operation mapping is TODO.",
    );
  }

  async unmount(): Promise<void> {
    if (!this.mounted) {
      return;
    }

    // TODO(native): call fuse-native unmount and release operation handlers.
    this.handlers?.deactivate();
    this.handlers = null;
    this.mountPoint = null;
    this.mounted = false;
  }
}

export function createNodeFallbackBackend(): Backend {
  return new NodeFallbackBackend();
}
