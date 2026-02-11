import type { Backend, FileSystemHandlers } from "./index";

class FFIFuseBackend implements Backend {
  private mounted = false;
  private mountPoint: string | null = null;
  private handlers: FileSystemHandlers | null = null;

  async mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void> {
    if (this.mounted) {
      throw new Error(`openfuse/fuse: already mounted at \"${this.mountPoint}\"`);
    }

    handlers.activate();

    try {
      // TODO(native): bind libfuse3 low-level APIs through bun:ffi.
      // Planned implementation: fuse_session_new, fuse_session_mount,
      // fuse_session_loop, and fuse_reply_* with operation callbacks mapped
      // to the openfuse handler surface.
      const ffi = await import("bun:ffi");
      void ffi;
    } catch {
      handlers.deactivate();
      throw new Error(
        "openfuse/fuse: bun:ffi is unavailable. Install Bun runtime to use the FUSE backend.",
      );
    }

    handlers.deactivate();
    throw new Error(
      "openfuse/fuse: bun:ffi FUSE backend is scaffolded but native libfuse wiring is TODO.",
    );
  }

  async unmount(): Promise<void> {
    if (!this.mounted) {
      return;
    }

    // TODO(native): tear down fuse session and stop event loop cleanly.
    this.handlers?.deactivate();
    this.handlers = null;
    this.mountPoint = null;
    this.mounted = false;
  }
}

export function createFFIBackend(): Backend {
  return new FFIFuseBackend();
}
