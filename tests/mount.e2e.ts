/**
 * Integration mount test.
 *
 * Default import mode: workspace build output.
 * Set OPENFUSE_E2E_IMPORT=package to validate a packaged consumer install.
 *
 * Run inside Docker with FUSE support:
 *   docker compose -f docker-compose.test.yml run test-node
 */
import { mkdtemp, mkdir, readFile, readdir, rm, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout } from "node:timers/promises";

// By default, run against workspace build output.
// For package-consumer smoke tests, set OPENFUSE_E2E_IMPORT=package.
const importMode = process.env.OPENFUSE_E2E_IMPORT ?? "workspace-dist";
const { createFileSystem } = importMode === "package"
  ? await import("openfuse")
  : await import("../packages/openfuse/dist/index.js");

// Import MemoryFileSystem — but it's a .ts file, so we need the built version
// For now, inline a minimal memory FS for testing
class SimpleMemoryFS {
  constructor() {
    this.nextId = 3n;
    this.nodes = new Map();
    const now = new Date();
    this.nodes.set(2n, {
      id: 2n, type: 2, name: "", mode: 0o755, children: new Map(),
      size: 0n, createTime: now, modifyTime: now, accessTime: now, linkCount: 1,
    });
  }

  activate() {
    const root = this.nodes.get(2n);
    return { id: root.id, name: root.name, attributes: { type: root.type, size: 0n, mode: root.mode } };
  }

  deactivate() {}

  lookup(name, directoryId) {
    const dir = this.nodes.get(directoryId);
    if (!dir || dir.type !== 2) throw Object.assign(new Error("ENOTDIR"), { errno: 20 });
    const childId = dir.children.get(name);
    if (!childId) throw Object.assign(new Error("ENOENT"), { errno: 2 });
    const node = this.nodes.get(childId);
    return { id: node.id, name: node.name, attributes: this.getAttributes(node.id) };
  }

  getAttributes(itemId) {
    const node = this.nodes.get(itemId);
    if (!node) throw Object.assign(new Error("ENOENT"), { errno: 2 });
    return {
      type: node.type,
      size: node.type === 1 ? BigInt(node.content?.length ?? 0) : 0n,
      mode: node.mode,
      uid: process.getuid?.() ?? 0,
      gid: process.getgid?.() ?? 0,
      modifyTime: node.modifyTime,
      accessTime: node.accessTime,
      createTime: node.createTime,
      linkCount: node.linkCount ?? 1,
    };
  }

  readdir(directoryId, cookie) {
    const dir = this.nodes.get(directoryId);
    if (!dir || dir.type !== 2) throw Object.assign(new Error("ENOTDIR"), { errno: 20 });
    const items = [...dir.children.entries()];
    const start = Number(cookie);
    const entries = [];
    for (let i = start; i < items.length; i++) {
      const [name, id] = items[i];
      const node = this.nodes.get(id);
      entries.push({
        item: { id: node.id, name, attributes: this.getAttributes(node.id) },
        nextCookie: i + 1 < items.length ? BigInt(i + 1) : 0n,
      });
    }
    return { entries };
  }

  read(itemId, offset, length) {
    const node = this.nodes.get(itemId);
    if (!node || node.type !== 1) throw Object.assign(new Error("EISDIR"), { errno: 21 });
    const start = Number(offset);
    const len = Number(length);
    if (start >= (node.content?.length ?? 0)) return Buffer.alloc(0);
    return Buffer.from((node.content ?? Buffer.alloc(0)).subarray(start, start + len));
  }

  write(itemId, offset, data) {
    const node = this.nodes.get(itemId);
    if (!node || node.type !== 1) throw Object.assign(new Error("EISDIR"), { errno: 21 });
    const start = Number(offset);
    const needed = start + data.length;
    if (needed > (node.content?.length ?? 0)) {
      const expanded = Buffer.alloc(needed);
      if (node.content) node.content.copy(expanded);
      node.content = expanded;
    }
    data.copy(node.content, start);
    node.modifyTime = new Date();
    return BigInt(data.length);
  }

  create(name, type, directoryId, mode) {
    const dir = this.nodes.get(directoryId);
    if (!dir || dir.type !== 2) throw Object.assign(new Error("ENOTDIR"), { errno: 20 });
    if (dir.children.has(name)) throw Object.assign(new Error("EEXIST"), { errno: 17 });
    const id = this.nextId++;
    const now = new Date();
    const node = { id, type, name, mode, createTime: now, modifyTime: now, accessTime: now, linkCount: 1 };
    if (type === 1) node.content = Buffer.alloc(0);
    if (type === 2) node.children = new Map();
    this.nodes.set(id, node);
    dir.children.set(name, id);
    dir.modifyTime = now;
    return { id, name, attributes: this.getAttributes(id) };
  }

  remove(name, directoryId) {
    const dir = this.nodes.get(directoryId);
    if (!dir || dir.type !== 2) throw Object.assign(new Error("ENOTDIR"), { errno: 20 });
    const childId = dir.children.get(name);
    if (!childId) throw Object.assign(new Error("ENOENT"), { errno: 2 });
    const child = this.nodes.get(childId);
    if (child.type === 2 && child.children.size > 0) throw Object.assign(new Error("ENOTEMPTY"), { errno: 39 });
    dir.children.delete(name);
    this.nodes.delete(childId);
    dir.modifyTime = new Date();
  }
}

// --- Test ---
async function main() {
  console.log("=== openfuse Node.js mount test ===\n");

  const memfs = new SimpleMemoryFS();

  // Pre-seed a file
  const root = memfs.activate();
  memfs.create("seed.txt", 1, root.id, 0o644);
  const seedItem = memfs.lookup("seed.txt", root.id);
  memfs.write(seedItem.id, 0n, Buffer.from("hello from openfuse!"));

  const fs = createFileSystem(memfs);
  const mountPoint = await mkdtemp(join(tmpdir(), "openfuse-test-"));

  console.log(`Mounting at ${mountPoint}...`);
  await fs.mount(mountPoint);
  console.log("Mounted!\n");

  // Small delay for FUSE to be ready
  await setTimeout(200);

  // Test 1: readdir (async to avoid deadlocking the event loop while serving FUSE callbacks)
  const entries = await readdir(mountPoint);
  console.log(`readdir: ${JSON.stringify(entries)}`);
  assert(entries.includes("seed.txt"), "seed.txt should be in readdir");

  // Test 2: read existing file
  const content = await readFile(join(mountPoint, "seed.txt"), "utf8");
  console.log(`read seed.txt: "${content}"`);
  assert(content === "hello from openfuse!", "seed.txt content mismatch");

  // Test 3: write new file
  await writeFile(join(mountPoint, "new.txt"), "written via node:fs!");
  const newContent = await readFile(join(mountPoint, "new.txt"), "utf8");
  console.log(`write+read new.txt: "${newContent}"`);
  assert(newContent === "written via node:fs!", "new.txt content mismatch");

  // Test 4: mkdir
  await mkdir(join(mountPoint, "mydir"));
  const dirStat = await stat(join(mountPoint, "mydir"));
  console.log(`mkdir mydir: isDirectory=${dirStat.isDirectory()}`);
  assert(dirStat.isDirectory(), "mydir should be a directory");

  // Test 5: unlink
  await unlink(join(mountPoint, "new.txt"));
  const afterUnlink = await readdir(mountPoint);
  console.log(`after unlink new.txt: ${JSON.stringify(afterUnlink)}`);
  assert(!afterUnlink.includes("new.txt"), "new.txt should be gone");

  // Test 6: rmdir
  await rmdir(join(mountPoint, "mydir"));
  const afterRmdir = await readdir(mountPoint);
  console.log(`after rmdir mydir: ${JSON.stringify(afterRmdir)}`);
  assert(!afterRmdir.includes("mydir"), "mydir should be gone");

  console.log("\nUnmounting...");
  await fs.unmount();
  console.log("Unmounted!");

  // Cleanup
  await rm(mountPoint, { recursive: true, force: true });

  console.log("\n✅ All tests passed!");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
