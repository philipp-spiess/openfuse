# OpenFuse — Cross-platform user-space file systems for Node.js & Bun

## What to build

A TypeScript/Node.js package called `openfuse` that lets developers create user-space file systems with a single API that works on Linux (FUSE) and macOS (FSKit via FSKitBridge). Windows (ProjFS) is out of scope for now.

## Architecture

```
openfuse/
├── src/
│   ├── index.ts              # Main entry: createFileSystem() + types
│   ├── types.ts              # All TypeScript types (see fskit-api.ts for reference)
│   ├── backends/
│   │   ├── backend.ts        # Abstract backend interface
│   │   ├── fuse.ts           # Linux: FUSE backend (wraps fuse-native)
│   │   └── fskit.ts          # macOS: FSKitBridge TCP+protobuf backend
│   └── utils/
│       └── errors.ts         # POSIX error codes (ENOENT, EEXIST, ENOSPC, etc.)
├── test/
│   ├── memory-fs.ts          # In-memory FS implementation for testing
│   ├── core.test.ts          # Core API tests (platform-agnostic, test the memory-fs)
│   ├── mount.test.ts         # Integration tests (actually mounts, reads/writes files)
│   └── setup.ts              # Test helpers
├── examples/
│   └── memory-fs.ts          # Example: mount an in-memory filesystem
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions: test on ubuntu + macos
├── tsconfig.json
├── package.json
├── vitest.config.ts
├── README.md
└── LICENSE                   # MIT
```

## The API (v0.0.1 — minimal surface)

For v0.0.1, only implement these callbacks (not the full FSKit surface):

```ts
import { createFileSystem } from "openfuse";

const fs = createFileSystem({
  // Called on mount. Return the root directory item.
  activate(): Item { ... },

  // Look up an item by name in a directory. Throw ENOENT if not found.
  lookup(name: string, directoryId: bigint): Item { ... },

  // Get attributes (size, mode, timestamps, type) for an item.
  getAttributes(itemId: bigint): ItemAttributes { ... },

  // List directory contents. Return entries with pagination cookies.
  readdir(directoryId: bigint, cookie: bigint): DirectoryEntries { ... },

  // Read file contents at offset.
  read(itemId: bigint, offset: bigint, length: bigint): Buffer { ... },

  // Write to a file at offset. Return bytes written.
  write(itemId: bigint, offset: bigint, data: Buffer): bigint { ... },

  // Create a file or directory.
  create(name: string, type: ItemType, directoryId: bigint, mode: number): Item { ... },

  // Remove an item from a directory.
  remove(name: string, directoryId: bigint): void { ... },

  // Called on unmount. Clean up.
  deactivate(): void { ... },
});

await fs.mount("/tmp/myfs");
// filesystem is now accessible at /tmp/myfs!

// Later:
await fs.unmount();
```

Keep the types simple and JS-friendly:
- Use `string` for names (not Buffer) in the user-facing API
- Use `bigint` for item IDs, offsets, sizes
- Use `number` for mode, uid, gid

## Types (simplified for v0.0.1)

```ts
enum ItemType { File, Directory, Symlink }

interface ItemAttributes {
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

interface Item {
  id: bigint;
  name: string;
  attributes: ItemAttributes;
}

interface DirectoryEntry {
  item: Item;
  nextCookie: bigint;  // 0n = no more entries
}

interface DirectoryEntries {
  entries: DirectoryEntry[];
}

interface FileSystem {
  mount(mountPoint: string): Promise<void>;
  unmount(): Promise<void>;
  readonly mounted: boolean;
  readonly mountPoint: string | null;
}
```

## Backend details

### Linux (FUSE)
- Use `fuse-native` npm package as the FUSE binding
- Map our callbacks to fuse-native's ops (getattr, readdir, read, write, create, unlink, mkdir, rmdir, lookup)
- fuse-native handles the /dev/fuse communication

### macOS (FSKit via FSKitBridge)
- FSKitBridge is a prebuilt macOS app that runs an FSKit extension
- It exposes a TCP server on localhost (default port 35367)
- Wire protocol: u32 length (network byte order) + protobuf message
- See `fskit-api.ts` in this repo for the full protobuf-derived type reference
- For v0.0.1: implement a TCP client that speaks this protocol
- Use `protobufjs` for encoding/decoding
- Copy the proto file from: https://raw.githubusercontent.com/debox-network/FSKitBridge/main/FSKitExt/protocol.proto

### Platform detection
```ts
import { platform } from "node:os";
// platform() === "linux" → FUSE backend
// platform() === "darwin" → FSKit backend
// else → throw "Unsupported platform"
```

## Testing strategy

### 1. Unit tests (core.test.ts) — platform-agnostic
Test the in-memory filesystem implementation directly (no mounting):
- Create files and directories
- Read/write content
- Lookup by name
- Readdir with pagination
- Remove items
- Error cases (ENOENT, EEXIST)
- Attribute handling (mode, timestamps, size updates on write)

### 2. Integration tests (mount.test.ts) — platform-specific
Actually mount the in-memory FS and use Node's `fs` module to interact:
- `fs.readdir()` on mounted path
- `fs.readFile()` / `fs.writeFile()`
- `fs.mkdir()` / `fs.rmdir()`
- `fs.stat()` returns correct attributes
- `fs.unlink()`
- Verify unmount cleans up

These tests require:
- Linux: FUSE kernel module (available on GitHub runners)
- macOS: FSKitBridge installed + macOS 15.4+ (may need to skip in CI initially)

### 3. GitHub Actions CI (.github/workflows/ci.yml)
```yaml
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest]
```
- Install dependencies per platform
- Linux: `sudo apt-get install -y libfuse-dev fuse3` + `sudo modprobe fuse`
- macOS: integration tests may be skipped initially (needs FSKitBridge + 15.4)
- Run unit tests on both platforms
- Run integration tests on Linux (FUSE is straightforward in CI)

## In-memory filesystem (test/memory-fs.ts + examples/)

Build a complete in-memory FS as both a test fixture and example:
- Tree of nodes (directories contain children map, files contain Buffer)
- Auto-incrementing item IDs
- Proper mode/timestamp handling
- This is what people will copy-paste to get started

## Package setup
- **Build:** tsup or unbuild (ESM + CJS)
- **Test:** vitest
- **Node:** >= 20
- **Exports:** ESM primary, CJS fallback
- **Dependencies:** `fuse-native` (optional/linux), `protobufjs` (for fskit)

## What NOT to build yet
- Windows/ProjFS support
- Extended attributes (xattrs)
- Symlink/hardlink support
- Access control (checkAccess)
- Preallocation
- Volume rename
- Open/close tracking
- Kernel offloaded I/O
- Any CLI tools

## Reference
- `fskit-api.ts` in this repo — full FSKit API surface in TypeScript (for reference only, don't implement all of it)
- FSKitBridge: https://github.com/debox-network/FSKitBridge
- FSKitBridge proto: https://raw.githubusercontent.com/debox-network/FSKitBridge/main/FSKitExt/protocol.proto
- fuse-native: https://github.com/fuse-friends/fuse-native
- Apple FSKit docs: https://developer.apple.com/documentation/FSKit

## Tone
This should feel like a modern, well-crafted npm package. Clean README, good examples, minimal but complete. Think: the quality bar of Tailwind CSS or Zod.
