declare module "fuse-native" {
  interface FuseOperations {
    access?(path: string, mode: number, cb: (code: number) => void): void;
    statfs?(path: string, cb: (code: number, stat?: Record<string, number>) => void): void;
    getattr?(path: string, cb: (code: number, stat?: Record<string, unknown>) => void): void;
    readdir?(path: string, cb: (code: number, names?: string[]) => void): void;
    open?(path: string, flags: number, cb: (code: number, fd?: number) => void): void;
    opendir?(path: string, flags: number, cb: (code: number, fd?: number) => void): void;
    read?(path: string, fd: number, buf: Buffer, len: number, pos: number, cb: (code: number, bytesRead?: number) => void): void;
    write?(path: string, fd: number, buf: Buffer, len: number, pos: number, cb: (code: number, bytesWritten?: number) => void): void;
    flush?(path: string, fd: number, cb: (code: number) => void): void;
    fsync?(path: string, fd: number, datasync: number, cb: (code: number) => void): void;
    fsyncdir?(path: string, fd: number, datasync: number, cb: (code: number) => void): void;
    release?(path: string, fd: number, cb: (code: number) => void): void;
    releasedir?(path: string, fd: number, cb: (code: number) => void): void;
    create?(path: string, mode: number, cb: (code: number, fd?: number) => void): void;
    unlink?(path: string, cb: (code: number) => void): void;
    mkdir?(path: string, mode: number, cb: (code: number) => void): void;
    rmdir?(path: string, cb: (code: number) => void): void;
  }

  interface FuseOptions {
    force?: boolean;
    debug?: boolean;
    mkdir?: boolean;
  }

  class Fuse {
    static ENOENT: number;
    static EACCES: number;
    static EIO: number;
    static EPERM: number;
    static EEXIST: number;
    static ENOTDIR: number;
    static EISDIR: number;
    static ENOSPC: number;
    static ENOTEMPTY: number;
    static ENOSYS: number;
    static EINVAL: number;
    static EBUSY: number;

    constructor(mountPoint: string, ops: FuseOperations, opts?: FuseOptions);
    mount(cb: (err?: Error) => void): void;
    unmount(cb: (err?: Error) => void): void;
  }

  export = Fuse;
}
