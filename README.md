# OpenFuse

Cross-platform user-space file systems for Node.js and Bun.

OpenFuse provides a single TypeScript API for implementing file system handlers, then mounts through platform backends:
- Linux: FUSE backend (`@openfuse/fuse`)
- macOS: FSKitBridge backend (`@openfuse/fskit`)

This repository is a Bun workspace monorepo and is Bun-first for install, build, and test.

## Status (v0.0.1 scaffold)

- Core API, types, and platform selection are implemented.
- In-memory filesystem fixture and tests are implemented.
- Backend architecture is in place.
- Native glue is intentionally scaffolded with clear TODOs:
  - `bun:ffi` FUSE low-level operation wiring
  - `fuse-native` Node fallback operation wiring
  - FSKitBridge request loop handling

## Install

```bash
bun install
```

## Quick Start

```ts
import { createFileSystem, ItemType } from "openfuse";

const fs = createFileSystem({
  activate() {
    return {
      id: 2n,
      name: "",
      attributes: {
        type: ItemType.Directory,
        size: 0n,
        mode: 0o755,
      },
    };
  },
  lookup(name, directoryId) {
    throw new Error(`ENOENT: ${name} in ${directoryId}`);
  },
  getAttributes() {
    return {
      type: ItemType.Directory,
      size: 0n,
      mode: 0o755,
    };
  },
  readdir() {
    return { entries: [] };
  },
  read() {
    return Buffer.alloc(0);
  },
  write() {
    return 0n;
  },
  create() {
    throw new Error("not implemented");
  },
  remove() {
    throw new Error("not implemented");
  },
  deactivate() {},
});

await fs.mount("/tmp/myfs");
await fs.unmount();
```

For a complete starter implementation, see:
- `packages/openfuse/test/memory-fs.ts`
- `examples/memory-fs.ts`

## Workspace Layout

```txt
openfuse/
├── packages/
│   ├── openfuse/
│   └── @openfuse/
│       ├── fuse/
│       └── fskit/
├── examples/
├── tests/
├── Dockerfile.test
├── docker-compose.test.yml
└── .github/workflows/ci.yml
```

## Commands

```bash
# Run all unit tests (Bun test runner)
bun test

# Run the core unit test file directly
bun test packages/openfuse/test/core.test.ts

# Build all workspace packages
bun run build

# Run Linux mount e2e script (Node.js 22+, requires FUSE)
node tests/node-mount-test.ts

# Run Linux mount e2e script (Bun runtime, requires FUSE + compiled bridge)
bun tests/node-mount-test.ts
```

## Docker Linux Test Setup

```bash
docker compose -f docker-compose.test.yml up --build
```

## CI

GitHub Actions runs:
- Unit tests with `bun test` on Ubuntu + macOS
- Linux mount e2e script on Node + Bun as experimental checks (`tests/node-mount-test.ts`)

## License

MIT
