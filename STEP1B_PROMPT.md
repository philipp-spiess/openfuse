# Task: Implement bun:ffi libfuse2 backend

## Context

You're in a monorepo at `~/dev/openfuse`. The file `packages/@openfuse/fuse/src/ffi.ts` currently has a stub that throws "not implemented". You need to implement a real FUSE backend using `bun:ffi` that calls libfuse2.

The Node.js backend (`node-fallback.ts`) already works — use it as reference for the path resolution and handler mapping logic.

## What to implement

### `packages/@openfuse/fuse/src/ffi.ts`

The approach: Write a small C bridge (`packages/@openfuse/fuse/src/bridge/fuse_bridge.c`) that wraps libfuse2 and exposes simple FFI-friendly C functions. Then call those from TypeScript via `bun:ffi`.

**Why a C bridge?** bun:ffi's `JSCallback` can create function pointers, but constructing the `fuse_operations` struct (30+ function pointer slots at specific byte offsets) and calling `fuse_main_real` from pure FFI is fragile. A tiny C shim (~150 lines) that takes individual function pointers as arguments and wires them into the struct is much cleaner.

### Bridge C API (`fuse_bridge.c`):

```c
#include <fuse.h>

// Callback typedefs matching what bun:ffi JSCallback can produce
typedef int (*bridge_getattr_fn)(const char* path, uint64_t* size, uint32_t* mode, uint32_t* nlink, uint32_t* uid, uint32_t* gid);
typedef int (*bridge_readdir_fn)(const char* path, void* buf, void* filler);
typedef int (*bridge_open_fn)(const char* path, int flags);
typedef int (*bridge_read_fn)(const char* path, char* buf, int size, int64_t offset);
typedef int (*bridge_write_fn)(const char* path, const char* buf, int size, int64_t offset);
typedef int (*bridge_create_fn)(const char* path, uint32_t mode);
typedef int (*bridge_unlink_fn)(const char* path);
typedef int (*bridge_mkdir_fn)(const char* path, uint32_t mode);
typedef int (*bridge_rmdir_fn)(const char* path);

// Simplified: the bridge stores callbacks globally and wires them into fuse_operations
void fuse_bridge_set_callbacks(
  bridge_getattr_fn getattr,
  bridge_readdir_fn readdir,
  bridge_open_fn open,
  bridge_read_fn read,
  bridge_write_fn write,
  bridge_create_fn create,
  bridge_unlink_fn unlink_cb,
  bridge_mkdir_fn mkdir_cb,
  bridge_rmdir_fn rmdir_cb
);

// Mount and run the FUSE event loop (blocks until unmount)
int fuse_bridge_mount(const char* mountpoint);

// Unmount (call from another thread/signal)
void fuse_bridge_unmount(const char* mountpoint);
```

The bridge internally:
1. Stores the JS callback pointers in static globals
2. Implements each `fuse_operations` handler by calling the stored callbacks
3. For `getattr`: calls `bridge_getattr_fn` which returns errno, and fills a `struct stat` from the out params
4. For `readdir`: calls `bridge_readdir_fn` which receives the `filler` function pointer — the JS side calls filler for each entry
5. Calls `fuse_main_real(argc, argv, &ops, sizeof(ops), NULL)` with the wired ops

### Compile the bridge

Add a build script or make the build step compile it:
```bash
cc -shared -o fuse_bridge.so fuse_bridge.c $(pkg-config --cflags --libs fuse) -fPIC
```

Store the compiled `.so` next to the package or in a `prebuilds/` directory.

For now, you can add a `prebuild` npm script in `packages/@openfuse/fuse/package.json`:
```json
"prebuild:bridge": "cc -shared -o src/bridge/fuse_bridge.so src/bridge/fuse_bridge.c $(pkg-config --cflags --libs fuse) -fPIC"
```

### TypeScript side (`ffi.ts`)

```ts
import { dlopen, JSCallback, ptr, CString } from "bun:ffi";

// Load the bridge
const bridge = dlopen("path/to/fuse_bridge.so", {
  fuse_bridge_set_callbacks: { args: ["ptr","ptr","ptr","ptr","ptr","ptr","ptr","ptr","ptr"], returns: "void" },
  fuse_bridge_mount: { args: ["ptr"], returns: "int" },
  fuse_bridge_unmount: { args: ["ptr"], returns: "void" },
});

// Create JSCallbacks for each operation
// Map our handlers (path-based) to the simplified C callback signatures
// Use the same resolvePath/resolveParent logic from node-fallback.ts
```

### Key implementation details

1. **Path resolution**: Copy the `resolvePath` and `resolveParent` functions from `node-fallback.ts` (or extract to a shared module)
2. **The readdir filler**: The C bridge passes the fuse `filler` function pointer to JS. JS needs to call it for each directory entry. This is tricky — you may need to pass the filler as a `ptr` and call it via a second FFI function in the bridge like `fuse_bridge_fill_dir(filler_ptr, buf_ptr, name, null, 0)`
3. **Threading**: `fuse_bridge_mount` blocks (runs the FUSE event loop). Run it in a Worker or use `Bun.spawn` with a separate script. The JS callbacks will be called from FUSE threads — `JSCallback` handles this.
4. **String handling**: C strings from FUSE paths need to be read with `new CString(ptr)`. Strings passed to C need null termination — use `Buffer.from(str + "\0")`.
5. **Error codes**: Return negative errno values from callbacks (e.g., `-2` for ENOENT). Same as node-fallback.ts.

### The `FileSystemHandlers` interface (from index.ts)

```ts
interface FileSystemHandlers {
  activate(): { id: bigint; attributes: { type: number } };
  lookup(name: string, directoryId: bigint): { id: bigint; name: string };
  getAttributes(itemId: bigint): { type: number; size: bigint; mode: number; uid?: number; gid?: number; modifyTime?: Date; accessTime?: Date; createTime?: Date; linkCount?: number; };
  readdir(directoryId: bigint, cookie: bigint): { entries: Array<{ item: { id: bigint; name: string }; nextCookie: bigint; }>; };
  read(itemId: bigint, offset: bigint, length: bigint): Buffer;
  write(itemId: bigint, offset: bigint, data: Buffer): bigint;
  create(name: string, type: number, directoryId: bigint, mode: number): { id: bigint };
  remove(name: string, directoryId: bigint): void;
  deactivate(): void;
}
```

### Backend interface

```ts
interface Backend {
  mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void>;
  unmount(): Promise<void>;
}
```

## Files to create/modify

1. **CREATE** `packages/@openfuse/fuse/src/bridge/fuse_bridge.c` — the C bridge
2. **MODIFY** `packages/@openfuse/fuse/src/ffi.ts` — real implementation using bun:ffi + bridge
3. **MODIFY** `packages/@openfuse/fuse/package.json` — add bridge build script
4. **CREATE** `packages/@openfuse/fuse/src/path-utils.ts` — extract shared path resolution from node-fallback.ts (avoid duplication)
5. **MODIFY** `packages/@openfuse/fuse/src/node-fallback.ts` — import path utils from shared module

## Constraints

- Do NOT modify any files outside `packages/@openfuse/fuse/`
- The bun:ffi backend must implement the same `Backend` interface
- All existing tests must still pass (`bun test` from repo root)
- `bun run build` must still succeed
- The C bridge should compile with standard `cc` and `pkg-config --cflags --libs fuse`

## Definition of done

1. `fuse_bridge.c` compiles to `fuse_bridge.so` on Linux with libfuse2
2. `ffi.ts` uses `bun:ffi` + `dlopen` to load the bridge and implement all 9 operations
3. Shared path resolution between node-fallback.ts and ffi.ts (no code duplication)
4. `bun run build` succeeds
5. `bun test` passes
6. The in-memory filesystem can mount/read/write/unmount via the bun:ffi path on Linux

When completely finished, run: `openclaw system event --text "Done: bun:ffi FUSE backend implemented with C bridge" --mode now`
