# OpenFuse — Cross-platform user-space file systems for Node.js & Bun

## What to build

A TypeScript package called `openfuse` that lets developers create user-space file systems with a single API that works on Linux (FUSE) and macOS (FSKit via FSKitBridge). Windows is out of scope for now.

**Bun-first.** Bun as package manager, test runner, and build tool. Everything should work with `bun install`, `bun test`, `bun build`.

## Monorepo structure

Bun workspace monorepo:

```
openfuse/
├── packages/
│   ├── openfuse/                # Main package — core types + API + platform detection
│   │   ├── src/
│   │   │   ├── index.ts         # Main entry: createFileSystem() + re-exports
│   │   │   ├── types.ts         # All TypeScript types
│   │   │   ├── errors.ts        # POSIX error helpers (ENOENT, EEXIST, ENOSPC, etc.)
│   │   │   └── platform.ts      # Detect OS, load correct backend
│   │   ├── test/
│   │   │   ├── memory-fs.ts     # In-memory FS implementation (test fixture + example)
│   │   │   ├── core.test.ts     # Unit tests against memory-fs (no mounting)
│   │   │   └── mount.test.ts    # Integration tests (mount + use node:fs to verify)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── @openfuse/fuse/          # Linux backend — FUSE via bun:ffi + node fallback
│   │   ├── src/
│   │   │   ├── index.ts         # Backend export
│   │   │   ├── ffi.ts           # bun:ffi bindings to libfuse3
│   │   │   └── node-fallback.ts # node.js fallback using fuse-native (optional dep)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── @openfuse/fskit/         # macOS backend — FSKitBridge TCP + protobuf
│       ├── src/
│       │   ├── index.ts         # Backend export
│       │   ├── client.ts        # TCP client for FSKitBridge protocol
│       │   ├── protocol.ts      # Protobuf encode/decode (from protocol.proto)
│       │   └── protocol.proto   # Wire format (from FSKitBridge repo)
│       ├── package.json
│       └── tsconfig.json
│
├── examples/
│   └── memory-fs.ts             # Example: mount an in-memory filesystem
│
├── docker-compose.test.yml      # Linux FUSE testing from macOS
├── Dockerfile.test              # Test container with bun + fuse3
├── .github/
│   └── workflows/
│       └── ci.yml               # GitHub Actions: test on ubuntu + macos
│
├── package.json                 # Workspace root
├── bunfig.toml                  # Bun workspace config
├── tsconfig.json                # Root tsconfig
├── README.md
└── LICENSE                      # MIT
```

## The API (v0.0.1 — minimal surface)

```ts
import { createFileSystem, ItemType } from "openfuse";

const fs = createFileSystem({
  // Called on mount. Return the root directory item.
  activate(): Item { ... },

  // Look up an item by name in a directory. Throw ENOENT if not found.
  lookup(name: string, directoryId: bigint): Item { ... },

  // Get attributes for an item.
  getAttributes(itemId: bigint): ItemAttributes { ... },

  // List directory contents with pagination.
  readdir(directoryId: bigint, cookie: bigint): DirectoryEntries { ... },

  // Read file contents at offset.
  read(itemId: bigint, offset: bigint, length: bigint): Buffer { ... },

  // Write to a file at offset. Return bytes written.
  write(itemId: bigint, offset: bigint, data: Buffer): bigint { ... },

  // Create a file or directory.
  create(name: string, type: ItemType, directoryId: bigint, mode: number): Item { ... },

  // Remove an item from a directory.
  remove(name: string, directoryId: bigint): void { ... },

  // Called on unmount.
  deactivate(): void { ... },
});

await fs.mount("/tmp/myfs");
// filesystem is now accessible!

await fs.unmount();
```

## Types (v0.0.1 — keep it simple)

```ts
export enum ItemType {
  File = 1,
  Directory = 2,
  Symlink = 3,
}

export interface ItemAttributes {
  type: ItemType;
  size: bigint;
  mode: number;        // e.g. 0o755
  uid?: number;
  gid?: number;
  modifyTime?: Date;
  accessTime?: Date;
  createTime?: Date;
  linkCount?: number;  // default 1
}

export interface Item {
  id: bigint;
  name: string;
  attributes: ItemAttributes;
}

export interface DirectoryEntry {
  item: Item;
  nextCookie: bigint;  // 0n = no more entries
}

export interface DirectoryEntries {
  entries: DirectoryEntry[];
}

export interface FileSystemHandlers {
  activate(): Item;
  lookup(name: string, directoryId: bigint): Item;
  getAttributes(itemId: bigint): ItemAttributes;
  readdir(directoryId: bigint, cookie: bigint): DirectoryEntries;
  read(itemId: bigint, offset: bigint, length: bigint): Buffer;
  write(itemId: bigint, offset: bigint, data: Buffer): bigint;
  create(name: string, type: ItemType, directoryId: bigint, mode: number): Item;
  remove(name: string, directoryId: bigint): void;
  deactivate(): void;
}

export interface FileSystem {
  mount(mountPoint: string): Promise<void>;
  unmount(): Promise<void>;
  readonly mounted: boolean;
  readonly mountPoint: string | null;
}
```

## Backend interface

Each backend implements this internal interface:

```ts
export interface Backend {
  mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void>;
  unmount(): Promise<void>;
}
```

### Linux FUSE backend (@openfuse/fuse)

**Primary: `bun:ffi` bindings to libfuse3**
- Use `Bun.FFI` / `bun:ffi` to `dlopen("libfuse3.so")` and call the FUSE low-level API
- Map our FileSystemHandlers to FUSE operations (getattr, lookup, readdir, read, write, mknod, mkdir, unlink, rmdir)
- This is the Bun-native zero-compile path
- Key functions to bind: `fuse_session_new`, `fuse_session_mount`, `fuse_session_loop`, `fuse_reply_*`
- Use the low-level FUSE API (not the high-level one) for better control

**Fallback: `fuse-native` for Node.js**
- If `bun:ffi` is not available (running under Node), fall back to `fuse-native`
- `fuse-native` is an optional dependency
- Detect runtime: `typeof Bun !== "undefined"` → use ffi, else → use fuse-native

### macOS FSKit backend (@openfuse/fskit)

- FSKitBridge is a prebuilt macOS app with an FSKit extension
- Exposes TCP on localhost:35367
- Wire protocol: u32 length (network byte order) + protobuf bytes
- Use `protobufjs` or `@bufbuild/protobuf` for encoding/decoding
- Copy proto from: https://raw.githubusercontent.com/debox-network/FSKitBridge/main/FSKitExt/protocol.proto
- Implement a TCP client using `net.createConnection`

### Platform detection (packages/openfuse/src/platform.ts)

```ts
import { platform } from "node:os";

export async function createBackend(): Promise<Backend> {
  switch (platform()) {
    case "linux":
      return (await import("@openfuse/fuse")).createBackend();
    case "darwin":
      return (await import("@openfuse/fskit")).createBackend();
    default:
      throw new Error(`openfuse: unsupported platform "${platform()}"`);
  }
}
```

## Testing

### Unit tests (packages/openfuse/test/core.test.ts)
Test the in-memory FS implementation directly, no mounting:
- Create files and directories
- Read/write content
- Lookup by name (found + not found)
- Readdir with pagination cookies
- Remove items
- Error cases (ENOENT, EEXIST)
- Attribute handling (mode, timestamps, size updates on write)
- All tests use `bun:test`

### Integration tests (packages/openfuse/test/mount.test.ts)
Actually mount the in-memory FS and use `node:fs` to interact:
- `fs.readdirSync()` on mounted path
- `fs.readFileSync()` / `fs.writeFileSync()`
- `fs.mkdirSync()` / `fs.rmdirSync()`
- `fs.statSync()` returns correct attributes
- `fs.unlinkSync()`
- Verify unmount cleans up
- These tests are platform-conditional (skip if FUSE/FSKit not available)

### Docker for Linux testing (from macOS)

**Dockerfile.test:**
```dockerfile
FROM oven/bun:latest
RUN apt-get update && apt-get install -y fuse3 libfuse3-dev kmod
WORKDIR /app
COPY . .
RUN bun install
CMD ["bun", "test"]
```

**docker-compose.test.yml:**
```yaml
services:
  test-linux:
    build:
      context: .
      dockerfile: Dockerfile.test
    cap_add:
      - SYS_ADMIN
    devices:
      - "/dev/fuse:/dev/fuse"
    security_opt:
      - apparmor:unconfined
    volumes:
      - ./:/app
    working_dir: /app
    command: ["bun", "test"]
```

Run with: `docker compose -f docker-compose.test.yml up --build`

### GitHub Actions CI (.github/workflows/ci.yml)

```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    strategy:
      matrix:
        include:
          - os: ubuntu-latest
            test-type: all
          - os: macos-latest
            test-type: unit  # integration tests need FSKitBridge, skip for now

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install FUSE (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y fuse3 libfuse3-dev
          sudo modprobe fuse

      - run: bun install

      - name: Unit tests
        run: bun test --filter core

      - name: Integration tests (Linux only)
        if: matrix.test-type == 'all'
        run: bun test --filter mount
```

## In-memory filesystem (test fixture + example)

Build a complete in-memory FS in `packages/openfuse/test/memory-fs.ts` AND `examples/memory-fs.ts`:
- Tree of nodes: directories have `Map<string, bigint>` children, files have `Buffer` content
- Auto-incrementing bigint item IDs (root = 2n, matching FSKit convention)
- Proper mode/timestamp tracking
- Implements all `FileSystemHandlers` callbacks
- This is what people will copy-paste to get started

## Package setup

### Root package.json
```json
{
  "name": "openfuse-monorepo",
  "private": true,
  "workspaces": ["packages/*"]
}
```

### bunfig.toml
```toml
[install]
peer = false
```

### packages/openfuse/package.json
```json
{
  "name": "openfuse",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "dependencies": {
    "@openfuse/fuse": "workspace:*",
    "@openfuse/fskit": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5"
  },
  "scripts": {
    "build": "bun build ./src/index.ts --outdir ./dist --target node",
    "test": "bun test"
  }
}
```

### TypeScript
- Target: ESNext
- Module: ESNext / NodeNext resolution
- Strict mode
- Generate declaration files

## What NOT to build yet
- Windows/ProjFS support
- Extended attributes (xattrs)
- Symlink/hardlink creation
- Access control
- Preallocation
- Volume rename
- Open/close tracking
- Any CLI tools
- npm publish workflow

## Reference files in this repo
- `fskit-api.ts` — Full FSKit API surface in TypeScript (for understanding the protocol, don't implement all of it)

## External references
- FSKitBridge: https://github.com/debox-network/FSKitBridge
- FSKitBridge proto: https://raw.githubusercontent.com/debox-network/FSKitBridge/main/FSKitExt/protocol.proto
- fuse-native (Node fallback): https://github.com/fuse-friends/fuse-native
- libfuse3 API: https://libfuse.github.io/doxygen/fuse__lowlevel_8h.html
- Bun FFI: https://bun.sh/docs/runtime/ffi
- Apple FSKit docs: https://developer.apple.com/documentation/FSKit

## Quality bar
Modern, clean, minimal. Good README with a single compelling example. Think Zod or Hono level polish. No unnecessary abstractions. Ship the simplest thing that works.
