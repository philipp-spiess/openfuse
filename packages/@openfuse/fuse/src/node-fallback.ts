import type { Backend, FileSystemHandlers } from "./index";
import { resolveParent, resolvePath, toErrno } from "./path-utils";

class NodeFallbackBackend implements Backend {
  private fuse: unknown = null;
  private mounted = false;
  private mountPoint: string | null = null;

  async mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void> {
    if (this.mounted) {
      throw new Error(`openfuse/fuse: already mounted at "${this.mountPoint}"`);
    }

    const mod = await import("fuse-native");
    const Fuse = (mod.default ?? mod) as unknown as typeof import("fuse-native");

    const rootItem = handlers.activate();
    const rootId = rootItem.id;

    const ops = {
      getattr(path: string, cb: (code: number, stat?: Record<string, unknown>) => void) {
        try {
          let itemId: bigint;
          if (path === "/") {
            itemId = rootId;
          } else {
            const resolved = resolvePath(path, rootId, handlers);
            itemId = resolved.itemId;
          }

          const attrs = handlers.getAttributes(itemId);
          const isDir = attrs.type === 2; // ItemType.Directory
          const mode = isDir ? (0o40000 | (attrs.mode & 0o7777)) : (0o100000 | (attrs.mode & 0o7777));

          cb(0, {
            mtime: attrs.modifyTime ?? new Date(),
            atime: attrs.accessTime ?? new Date(),
            ctime: attrs.createTime ?? new Date(),
            size: Number(attrs.size),
            mode,
            uid: attrs.uid ?? process.getuid?.() ?? 0,
            gid: attrs.gid ?? process.getgid?.() ?? 0,
            nlink: attrs.linkCount ?? 1,
          });
        } catch (err) {
          cb(toErrno(err));
        }
      },

      readdir(path: string, cb: (code: number, names?: string[]) => void) {
        try {
          let dirId: bigint;
          if (path === "/") {
            dirId = rootId;
          } else {
            const resolved = resolvePath(path, rootId, handlers);
            dirId = resolved.itemId;
          }

          const names: string[] = [];
          let cookie = 0n;

          // eslint-disable-next-line no-constant-condition
          while (true) {
            const result = handlers.readdir(dirId, cookie);
            if (result.entries.length === 0) break;

            for (const entry of result.entries) {
              names.push(entry.item.name);
              cookie = entry.nextCookie;
            }

            if (cookie === 0n) break;
          }

          cb(0, names);
        } catch (err) {
          cb(toErrno(err));
        }
      },

      open(path: string, _flags: number, cb: (code: number, fd?: number) => void) {
        try {
          // Verify path exists
          if (path !== "/") {
            resolvePath(path, rootId, handlers);
          }
          cb(0, 0); // We don't track FDs, stateless
        } catch (err) {
          cb(toErrno(err));
        }
      },

      read(
        path: string,
        _fd: number,
        buf: Buffer,
        len: number,
        pos: number,
        cb: (code: number, bytesRead?: number) => void,
      ) {
        try {
          const resolved = resolvePath(path, rootId, handlers);
          const data = handlers.read(resolved.itemId, BigInt(pos), BigInt(len));
          data.copy(buf);
          cb(0, data.length);
        } catch (err) {
          cb(toErrno(err));
        }
      },

      write(
        path: string,
        _fd: number,
        buf: Buffer,
        len: number,
        pos: number,
        cb: (code: number, bytesWritten?: number) => void,
      ) {
        try {
          const resolved = resolvePath(path, rootId, handlers);
          const data = buf.subarray(0, len);
          const written = handlers.write(resolved.itemId, BigInt(pos), Buffer.from(data));
          cb(0, Number(written));
        } catch (err) {
          cb(toErrno(err));
        }
      },

      create(path: string, mode: number, cb: (code: number, fd?: number) => void) {
        try {
          const { parentId, name } = resolveParent(path, rootId, handlers);
          handlers.create(name, 1 /* ItemType.File */, parentId, mode & 0o7777);
          cb(0, 0);
        } catch (err) {
          cb(toErrno(err));
        }
      },

      unlink(path: string, cb: (code: number) => void) {
        try {
          const { parentId, name } = resolveParent(path, rootId, handlers);
          handlers.remove(name, parentId);
          cb(0);
        } catch (err) {
          cb(toErrno(err));
        }
      },

      mkdir(path: string, mode: number, cb: (code: number) => void) {
        try {
          const { parentId, name } = resolveParent(path, rootId, handlers);
          handlers.create(name, 2 /* ItemType.Directory */, parentId, mode & 0o7777);
          cb(0);
        } catch (err) {
          cb(toErrno(err));
        }
      },

      rmdir(path: string, cb: (code: number) => void) {
        try {
          const { parentId, name } = resolveParent(path, rootId, handlers);
          handlers.remove(name, parentId);
          cb(0);
        } catch (err) {
          cb(toErrno(err));
        }
      },
    };

    const fuse = new Fuse(mountPoint, ops, { force: true });
    this.fuse = fuse;

    await new Promise<void>((resolve, reject) => {
      fuse.mount((err?: Error) => {
        if (err) {
          handlers.deactivate();
          reject(new Error(`openfuse/fuse: mount failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });

    this.mounted = true;
    this.mountPoint = mountPoint;
  }

  async unmount(): Promise<void> {
    if (!this.mounted || !this.fuse) {
      return;
    }

    const fuse = this.fuse as import("fuse-native");
    await new Promise<void>((resolve, reject) => {
      fuse.unmount((err?: Error) => {
        if (err) reject(new Error(`openfuse/fuse: unmount failed: ${err.message}`));
        else resolve();
      });
    });

    this.fuse = null;
    this.mounted = false;
    this.mountPoint = null;
  }
}

export function createNodeFallbackBackend(): Backend {
  return new NodeFallbackBackend();
}
