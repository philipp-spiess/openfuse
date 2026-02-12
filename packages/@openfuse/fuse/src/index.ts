export interface FileSystemHandlers {
  activate(): { id: bigint; attributes: { type: number } };
  lookup(name: string, directoryId: bigint): { id: bigint; name: string };
  getAttributes(itemId: bigint): {
    type: number;
    size: bigint;
    mode: number;
    uid?: number;
    gid?: number;
    modifyTime?: Date;
    accessTime?: Date;
    createTime?: Date;
    linkCount?: number;
  };
  readdir(directoryId: bigint, cookie: bigint): {
    entries: Array<{
      item: { id: bigint; name: string };
      nextCookie: bigint;
    }>;
  };
  read(itemId: bigint, offset: bigint, length: bigint): Buffer;
  write(itemId: bigint, offset: bigint, data: Buffer): bigint;
  create(name: string, type: number, directoryId: bigint, mode: number): { id: bigint };
  remove(name: string, directoryId: bigint): void;
  deactivate(): void;
}

export interface Backend {
  mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void>;
  unmount(): Promise<void>;
}

function isBunRuntime(): boolean {
  return typeof Bun !== "undefined";
}

export async function createBackend(): Promise<Backend> {
  if (isBunRuntime()) {
    const mod = await import("./ffi");
    return mod.createFFIBackend();
  }

  const mod = await import("./node-fallback");
  return mod.createNodeFallbackBackend();
}
