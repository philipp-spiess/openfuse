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
├── Dockerfile.test
├── docker-compose.test.yml
└── .github/workflows/ci.yml
```

## Commands

```bash
# Run all tests
bun test

# Run unit tests only
bun test --filter core

# Run integration test file (guarded unless OPENFUSE_RUN_MOUNT_TESTS=1)
bun test --filter mount

# Build all workspace packages
bun run build
```

## Docker Linux Test Setup

```bash
docker compose -f docker-compose.test.yml up --build
```

## CI

GitHub Actions runs:
- Ubuntu: unit + mount test suite invocation
- macOS: unit tests

## License

MIT
