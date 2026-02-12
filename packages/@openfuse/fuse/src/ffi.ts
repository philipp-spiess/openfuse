import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { CString, JSCallback, dlopen, toBuffer } from "bun:ffi";

import type { Backend, FileSystemHandlers } from "./index";
import { resolveParent, resolvePath, toErrno } from "./path-utils";

interface BridgeSymbols {
  fuse_bridge_set_callbacks(
    getattr: number,
    readdir: number,
    open: number,
    read: number,
    write: number,
    create: number,
    unlinkCb: number,
    mkdirCb: number,
    rmdirCb: number,
  ): void;
  fuse_bridge_mount(mountpoint: string | Buffer): number;
  fuse_bridge_unmount(mountpoint: string | Buffer): void;
  fuse_bridge_fill_dir(fillerPtr: number, bufPtr: number, name: string | Buffer): number;
}

interface BridgeLibrary {
  symbols: BridgeSymbols;
  close(): void;
}

function toCStringBuffer(value: string): Buffer {
  return Buffer.from(`${value}\0`, "utf8");
}

function readCString(ptr: number | null): string {
  if (!ptr) {
    return "/";
  }
  return new CString(ptr as never).toString();
}

function writeU32(ptr: number | null, value: number): void {
  if (!ptr) {
    throw new Error("openfuse/fuse: null pointer for uint32 output");
  }
  const out = toBuffer(ptr as never, 0, 4);
  out.writeUInt32LE(value >>> 0, 0);
}

function writeU64(ptr: number | null, value: bigint): void {
  if (!ptr) {
    throw new Error("openfuse/fuse: null pointer for uint64 output");
  }
  const out = toBuffer(ptr as never, 0, 8);
  out.writeBigUInt64LE(BigInt.asUintN(64, value), 0);
}

function toBigInt(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function resolveBridgePath(): string {
  const candidates = [
    fileURLToPath(new URL("./bridge/fuse_bridge.so", import.meta.url)),
    fileURLToPath(new URL("../src/bridge/fuse_bridge.so", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "openfuse/fuse: missing bridge library (fuse_bridge.so). Run `bun run prebuild:bridge` in packages/@openfuse/fuse.",
  );
}

function loadBridge(): BridgeLibrary {
  const bridgePath = resolveBridgePath();
  return dlopen(bridgePath, {
    fuse_bridge_set_callbacks: {
      args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr", "ptr"],
      returns: "void",
    },
    fuse_bridge_mount: {
      args: ["cstring"],
      returns: "int",
    },
    fuse_bridge_unmount: {
      args: ["cstring"],
      returns: "void",
    },
    fuse_bridge_fill_dir: {
      args: ["ptr", "ptr", "cstring"],
      returns: "int",
    },
  }) as unknown as BridgeLibrary;
}

function callbackPtr(callback: JSCallback): number {
  if (!callback.ptr) {
    throw new Error("openfuse/fuse: JSCallback pointer is null");
  }
  return callback.ptr as unknown as number;
}

class FFIFuseBackend implements Backend {
  private mounted = false;
  private mountPoint: string | null = null;
  private handlers: FileSystemHandlers | null = null;
  private rootId: bigint | null = null;
  private bridge: BridgeLibrary | null = null;
  private callbacks: JSCallback[] = [];

  private closeCallbacks(): void {
    for (const cb of this.callbacks) {
      cb.close();
    }
    this.callbacks = [];
  }

  private createCallbacks(handlers: FileSystemHandlers, rootId: bigint, bridge: BridgeLibrary): JSCallback[] {
    const getattrCallback = new JSCallback((pathPtr, sizePtr, modePtr, nlinkPtr, uidPtr, gidPtr) => {
      try {
        const path = readCString(pathPtr as number | null);
        const itemId = path === "/" ? rootId : resolvePath(path, rootId, handlers).itemId;
        const attrs = handlers.getAttributes(itemId);
        const isDir = attrs.type === 2; // ItemType.Directory
        const mode = isDir ? (0o40000 | (attrs.mode & 0o7777)) : (0o100000 | (attrs.mode & 0o7777));

        writeU64(sizePtr as number | null, attrs.size);
        writeU32(modePtr as number | null, mode);
        writeU32(nlinkPtr as number | null, attrs.linkCount ?? 1);
        writeU32(uidPtr as number | null, attrs.uid ?? process.getuid?.() ?? 0);
        writeU32(gidPtr as number | null, attrs.gid ?? process.getgid?.() ?? 0);

        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "ptr", "ptr", "ptr", "ptr", "ptr"],
      returns: "int",
      threadsafe: true,
    });

    const readdirCallback = new JSCallback((pathPtr, bufPtr, fillerPtr) => {
      try {
        const path = readCString(pathPtr as number | null);
        const dirId = path === "/" ? rootId : resolvePath(path, rootId, handlers).itemId;
        let cookie = 0n;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const result = handlers.readdir(dirId, cookie);
          if (result.entries.length === 0) {
            break;
          }

          for (const entry of result.entries) {
            const fillResult = bridge.symbols.fuse_bridge_fill_dir(
              fillerPtr as number,
              bufPtr as number,
              toCStringBuffer(entry.item.name),
            );

            if (fillResult !== 0) {
              return 0;
            }

            cookie = entry.nextCookie;
          }

          if (cookie === 0n) {
            break;
          }
        }

        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "ptr", "ptr"],
      returns: "int",
      threadsafe: true,
    });

    const openCallback = new JSCallback((pathPtr, flags) => {
      try {
        const path = readCString(pathPtr as number | null);
        if (path !== "/") {
          resolvePath(path, rootId, handlers);
        }
        void flags;
        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "int"],
      returns: "int",
      threadsafe: true,
    });

    const readCallback = new JSCallback((pathPtr, outBufferPtr, size, offset) => {
      try {
        const path = readCString(pathPtr as number | null);
        const resolved = resolvePath(path, rootId, handlers);
        const maxSize = Math.max(0, size as number);
        const data = handlers.read(resolved.itemId, toBigInt(offset as number | bigint), BigInt(maxSize));
        const bytesToCopy = Math.min(maxSize, data.length);

        if (bytesToCopy > 0) {
          const out = toBuffer(outBufferPtr as never, 0, bytesToCopy);
          data.copy(out, 0, 0, bytesToCopy);
        }

        return bytesToCopy;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "ptr", "int", "i64"],
      returns: "int",
      threadsafe: true,
    });

    const writeCallback = new JSCallback((pathPtr, inBufferPtr, size, offset) => {
      try {
        const path = readCString(pathPtr as number | null);
        const resolved = resolvePath(path, rootId, handlers);
        const length = Math.max(0, size as number);
        const input = length > 0
          ? Buffer.from(toBuffer(inBufferPtr as never, 0, length))
          : Buffer.alloc(0);

        const written = handlers.write(
          resolved.itemId,
          toBigInt(offset as number | bigint),
          input,
        );

        return Number(written);
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "ptr", "int", "i64"],
      returns: "int",
      threadsafe: true,
    });

    const createCallback = new JSCallback((pathPtr, mode) => {
      try {
        const path = readCString(pathPtr as number | null);
        const { parentId, name } = resolveParent(path, rootId, handlers);
        handlers.create(name, 1 /* ItemType.File */, parentId, (mode as number) & 0o7777);
        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "u32"],
      returns: "int",
      threadsafe: true,
    });

    const unlinkCallback = new JSCallback((pathPtr) => {
      try {
        const path = readCString(pathPtr as number | null);
        const { parentId, name } = resolveParent(path, rootId, handlers);
        handlers.remove(name, parentId);
        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr"],
      returns: "int",
      threadsafe: true,
    });

    const mkdirCallback = new JSCallback((pathPtr, mode) => {
      try {
        const path = readCString(pathPtr as number | null);
        const { parentId, name } = resolveParent(path, rootId, handlers);
        handlers.create(name, 2 /* ItemType.Directory */, parentId, (mode as number) & 0o7777);
        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr", "u32"],
      returns: "int",
      threadsafe: true,
    });

    const rmdirCallback = new JSCallback((pathPtr) => {
      try {
        const path = readCString(pathPtr as number | null);
        const { parentId, name } = resolveParent(path, rootId, handlers);
        handlers.remove(name, parentId);
        return 0;
      } catch (error) {
        return toErrno(error);
      }
    }, {
      args: ["ptr"],
      returns: "int",
      threadsafe: true,
    });

    return [
      getattrCallback,
      readdirCallback,
      openCallback,
      readCallback,
      writeCallback,
      createCallback,
      unlinkCallback,
      mkdirCallback,
      rmdirCallback,
    ];
  }

  async mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void> {
    if (this.mounted) {
      throw new Error(`openfuse/fuse: already mounted at "${this.mountPoint}"`);
    }

    if (typeof Bun === "undefined") {
      throw new Error("openfuse/fuse: bun:ffi backend requires Bun runtime");
    }

    const bridge = loadBridge();
    const rootItem = handlers.activate();
    const rootId = rootItem.id;
    const callbacks = this.createCallbacks(handlers, rootId, bridge);

    try {
      bridge.symbols.fuse_bridge_set_callbacks(
        callbackPtr(callbacks[0]!),
        callbackPtr(callbacks[1]!),
        callbackPtr(callbacks[2]!),
        callbackPtr(callbacks[3]!),
        callbackPtr(callbacks[4]!),
        callbackPtr(callbacks[5]!),
        callbackPtr(callbacks[6]!),
        callbackPtr(callbacks[7]!),
        callbackPtr(callbacks[8]!),
      );

      const mountRc = bridge.symbols.fuse_bridge_mount(toCStringBuffer(mountPoint));
      if (mountRc !== 0) {
        throw new Error(`openfuse/fuse: ffi mount failed with code ${mountRc}`);
      }
    } catch (error) {
      for (const cb of callbacks) {
        cb.close();
      }
      bridge.close();
      handlers.deactivate();

      if (error instanceof Error) {
        throw error;
      }
      throw new Error("openfuse/fuse: ffi mount failed");
    }

    this.bridge = bridge;
    this.callbacks = callbacks;
    this.handlers = handlers;
    this.rootId = rootId;
    this.mounted = true;
    this.mountPoint = mountPoint;
  }

  async unmount(): Promise<void> {
    if (!this.mounted) {
      return;
    }

    try {
      if (this.bridge && this.mountPoint) {
        this.bridge.symbols.fuse_bridge_unmount(toCStringBuffer(this.mountPoint));
      }
    } finally {
      this.closeCallbacks();
      this.bridge?.close();
      this.handlers?.deactivate();

      this.bridge = null;
      this.handlers = null;
      this.rootId = null;
      this.mounted = false;
      this.mountPoint = null;
    }
  }
}

export function createFFIBackend(): Backend {
  return new FFIFuseBackend();
}
