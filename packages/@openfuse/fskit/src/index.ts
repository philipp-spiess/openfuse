import { FSKitTcpClient } from "./client";

export interface FileSystemHandlers {
  activate(): { id: bigint; name: string };
  lookup(name: string, directoryId: bigint): { id: bigint; name: string };
  getAttributes(itemId: bigint): { type: number; size: bigint; mode: number };
  readdir(directoryId: bigint, cookie: bigint): { entries: Array<{ nextCookie: bigint }> };
  read(itemId: bigint, offset: bigint, length: bigint): Buffer;
  write(itemId: bigint, offset: bigint, data: Buffer): bigint;
  create(name: string, type: number, directoryId: bigint, mode: number): { id: bigint; name: string };
  remove(name: string, directoryId: bigint): void;
  deactivate(): void;
}

export interface Backend {
  mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void>;
  unmount(): Promise<void>;
}

export interface FSKitBackendOptions {
  host?: string;
  port?: number;
}

class FSKitBackend implements Backend {
  private readonly client: FSKitTcpClient;
  private mounted = false;
  private handlers: FileSystemHandlers | null = null;

  constructor(options: FSKitBackendOptions = {}) {
    this.client = new FSKitTcpClient({
      host: options.host,
      port: options.port,
    });
  }

  async mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void> {
    if (this.mounted) {
      throw new Error("openfuse/fskit: filesystem is already mounted");
    }

    this.handlers = handlers;
    const root = handlers.activate();

    try {
      await this.client.connect();
    } catch (error) {
      handlers.deactivate();
      this.handlers = null;
      throw new Error(
        `openfuse/fskit: unable to connect to FSKitBridge on localhost:35367 (${String(error)})`,
      );
    }

    void root;
    void mountPoint;

    // TODO(native): implement FSKit request loop.
    // 1) Send initial activate/mount handshake to FSKitBridge.
    // 2) Receive Request envelopes and translate each operation to handlers.
    // 3) Reply with properly encoded Response envelopes and POSIX errors.
    await this.client.disconnect();
    handlers.deactivate();
    this.handlers = null;

    throw new Error(
      "openfuse/fskit: FSKit TCP backend is scaffolded but request handling is TODO.",
    );
  }

  async unmount(): Promise<void> {
    if (!this.mounted) {
      return;
    }

    await this.client.disconnect();
    this.handlers?.deactivate();
    this.handlers = null;
    this.mounted = false;
  }
}

export async function createBackend(options: FSKitBackendOptions = {}): Promise<Backend> {
  return new FSKitBackend(options);
}
