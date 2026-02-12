# Task: Wire up the FUSE backend with fuse-native (Node) + bun:ffi libfuse2 (Bun)

## Context

This is a monorepo at `~/dev/openfuse` with three packages:
- `packages/openfuse` — core API, types, errors, platform detection (DONE)
- `packages/@openfuse/fuse` — Linux FUSE backend (STUBS — needs real implementation)
- `packages/@openfuse/fskit` — macOS FSKit backend (leave alone for now)

The core API and types are solid. The in-memory filesystem test fixture works. Unit tests pass. What's missing is the actual FUSE backend — both `ffi.ts` (Bun path) and `node-fallback.ts` (Node path) are stubs that throw "TODO".

## What to implement

### 1. `packages/@openfuse/fuse/src/node-fallback.ts` — fuse-native backend (Node.js)

Wire up `fuse-native` (npm package, already in devDependencies or add it) to implement the `Backend` interface. fuse-native uses libfuse2.

fuse-native API (simplified):
```js
const Fuse = require('fuse-native')
const fuse = new Fuse(mountPoint, {
  getattr(path, cb) { cb(0, { mode, size, mtime, atime, ctime, uid, gid, nlink }) },
  readdir(path, cb) { cb(0, ['file1', 'file2']) },
  open(path, flags, cb) { cb(0, fd) },
  read(path, fd, buf, len, pos, cb) { /* copy into buf */ cb(bytesRead) },
  write(path, fd, buf, len, pos, cb) { cb(bytesWritten) },
  create(path, mode, cb) { cb(0, fd) },
  unlink(path, cb) { cb(0) },
  mkdir(path, mode, cb) { cb(0) },
  rmdir(path, cb) { cb(0) },
}, { force: true })
fuse.mount(err => { ... })
fuse.unmount(err => { ... })
```

**Key challenge:** Our API uses item IDs (bigint) and structured types. fuse-native uses POSIX paths. You need to maintain a path→ID mapping:

- On `getattr(path)`: parse path to find parent dir ID, lookup the last component, return attributes
- On `readdir(path)`: resolve path to directory ID, call handlers.readdir(), return names
- On `read/write/create/unlink/mkdir/rmdir`: similar path resolution

**Path resolution logic:**
1. Split path by `/`, filter empty strings
2. Start from root item ID (returned by `handlers.activate()`)
3. For each component, call `handlers.lookup(component, currentDirId)`
4. The final item is your target

**Error mapping:**
- Our `PosixError` has `.errno` — pass `-error.errno` to fuse-native callbacks
- For unexpected errors, return `-Fuse.EIO`

**Important details:**
- `fuse.mount()` is async via callback — wrap in Promise
- `fuse.unmount()` same — wrap in Promise  
- The mount call blocks (fuse event loop runs) — fuse-native handles this internally with threads
- `getattr` for root path `/` should return the root item attributes
- `open` can just return fd=0 (we don't track file descriptors, our API is stateless)
- For `read`: fuse-native passes a pre-allocated Buffer `buf` — copy data into it, return bytes read
- `Fuse.ENOENT`, `Fuse.EIO` etc. are available as static constants

### 2. `packages/@openfuse/fuse/src/ffi.ts` — bun:ffi backend (Bun)

Use `bun:ffi` to call libfuse2 (`libfuse.so.2` on Linux, `libfuse.2.dylib` on macOS) directly.

libfuse2 low-level C API we need:
```c
// From <fuse/fuse.h> — the HIGH-level API (easier than low-level)
struct fuse_operations {
    int (*getattr)(const char *path, struct stat *stbuf);
    int (*readdir)(const char *path, void *buf, fuse_fill_dir_t filler, off_t offset, struct fuse_file_info *fi);
    int (*open)(const char *path, struct fuse_file_info *fi);
    int (*read)(const char *path, char *buf, size_t size, off_t offset, struct fuse_file_info *fi);
    int (*write)(const char *path, const char *buf, size_t size, off_t offset, struct fuse_file_info *fi);
    int (*create)(const char *path, mode_t mode, struct fuse_file_info *fi);
    int (*unlink)(const char *path);
    int (*mkdir)(const char *path, mode_t mode);
    int (*rmdir)(const char *path);
};

// Main entry point
int fuse_main(int argc, char *argv[], const struct fuse_operations *op, void *private_data);
```

**HOWEVER** — bun:ffi can't easily handle C struct callbacks (function pointers inside structs). A simpler approach:

Use bun:ffi to call the **FUSE low-level API** instead:
```c
struct fuse_session *fuse_session_new(struct fuse_args *args, const struct fuse_lowlevel_ops *op, size_t op_size, void *userdata);
int fuse_session_mount(struct fuse_session *se, const char *mountpoint);  
void fuse_session_loop(struct fuse_session *se);
void fuse_session_unmount(struct fuse_session *se);
void fuse_session_destroy(struct fuse_session *se);
```

**ACTUALLY** — the simplest viable approach for bun:ffi + libfuse2:

Since bun:ffi supports callbacks via `JSCallback`, we can use the high-level API by:
1. Manually constructing the `fuse_operations` struct in memory (it's just a struct of function pointers)
2. Using `JSCallback` for each operation
3. Calling `fuse_main_real` (the actual symbol behind the `fuse_main` macro)

```ts
import { dlopen, JSCallback, ptr, CString } from "bun:ffi";

const libfuse = dlopen("libfuse.so.2", {
  fuse_main_real: { args: ["int", "ptr", "ptr", "int", "ptr"], returns: "int" },
});
```

**Struct layout for `fuse_operations`** (libfuse2, x86_64 Linux):
The struct has ~30 function pointer fields. We only need to fill in the ones we use (getattr, readdir, open, read, write, create, unlink, mkdir, rmdir). The rest can be null pointers.

You'll need to figure out the correct byte offsets for each field in the struct. Check the libfuse2 header or use a helper to compute offsets.

**If this is too complex for bun:ffi**, an alternative approach:
- Write a tiny C shim (`fuse_bridge.c`) that exposes simpler FFI-friendly functions
- Compile it to a shared library
- Call that from bun:ffi

But try the pure bun:ffi approach first.

### 3. Runtime detection in `packages/@openfuse/fuse/src/index.ts`

Already done — `typeof Bun !== 'undefined'` picks ffi.ts vs node-fallback.ts. Just make sure both paths export `Backend` correctly.

### 4. Add fuse-native as a dependency

Add `fuse-native` to `packages/@openfuse/fuse/package.json` as an **optional** dependency (it's only needed for the Node path).

### 5. Docker test setup

Create/update `Dockerfile.test` and `docker-compose.test.yml` at repo root to test BOTH runtimes:

**Dockerfile.test:**
- Based on `node:22-bookworm-slim` 
- Install `libfuse-dev` and `fuse`
- Also install Bun
- Copy the monorepo
- Run tests with `OPENFUSE_RUN_MOUNT_TESTS=1`

**Two test services in docker-compose:**
1. `test-node` — runs `node` with fuse-native path
2. `test-bun` — runs `bun` with bun:ffi path

Both need: `devices: ["/dev/fuse:/dev/fuse"]`, `cap_add: [SYS_ADMIN]`, `security_opt: [apparmor:unconfined]`

### 6. Update mount.test.ts

The mount test in `packages/openfuse/test/mount.test.ts` should work as-is once the backend is wired up. Make sure:
- It can detect which runtime it's on
- It uses the correct backend
- Add a small delay after mount for FUSE to be ready
- Add timeout for the test (FUSE ops can be slow under qemu)

## Constraints

- **Do NOT modify** `packages/openfuse/src/` (types, errors, platform, index are done)
- **Do NOT modify** `packages/openfuse/test/core.test.ts` or `memory-fs.ts` (they work)
- **Do NOT touch** `packages/@openfuse/fskit/` (separate task)
- Use TypeScript throughout
- All existing tests must still pass (`bun test` in packages/openfuse)
- Use Bun as package manager (`bun install`, `bun add`)

## Definition of done

1. `bun run build` succeeds for all packages
2. `bun test` passes (existing unit tests + mount test skipped without env var)
3. Docker: `docker compose -f docker-compose.test.yml run test-node` → mount test passes with fuse-native
4. Docker: `docker compose -f docker-compose.test.yml run test-bun` → mount test passes with bun:ffi (stretch goal — if bun:ffi is too complex, leave a well-documented TODO and focus on node-fallback)
5. The in-memory filesystem can be mounted, read from, written to, and unmounted via both runtimes
