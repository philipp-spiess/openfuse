import { afterEach, expect, test } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createFileSystem } from "../src";
import { ItemType } from "../src/types";
import { createMemoryFileSystem } from "./memory-fs";

const RUN_MOUNT_TESTS = process.env.OPENFUSE_RUN_MOUNT_TESTS === "1";
const mountTest = RUN_MOUNT_TESTS ? test : test.skip;

const tempDirs: string[] = [];

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

if (!RUN_MOUNT_TESTS) {
  test("mount: integration tests are gated behind OPENFUSE_RUN_MOUNT_TESTS=1", () => {
    expect(RUN_MOUNT_TESTS).toBe(false);
  });
}

mountTest("mount: mounts in-memory FS and supports node:fs operations", async () => {
  const handlers = createMemoryFileSystem();
  const root = handlers.activate();
  const seed = handlers.create("seed.txt", ItemType.File, root.id, 0o644);
  handlers.write(seed.id, 0n, Buffer.from("seed-data"));

  const fs = createFileSystem(handlers);
  const mountPoint = mkdtempSync(join(tmpdir(), "openfuse-mount-"));
  tempDirs.push(mountPoint);

  await fs.mount(mountPoint);

  const initialEntries = readdirSync(mountPoint);
  expect(initialEntries).toContain("seed.txt");
  expect(readFileSync(join(mountPoint, "seed.txt"), "utf8")).toBe("seed-data");

  writeFileSync(join(mountPoint, "new.txt"), "hello");
  expect(readFileSync(join(mountPoint, "new.txt"), "utf8")).toBe("hello");

  mkdirSync(join(mountPoint, "docs"));
  expect(statSync(join(mountPoint, "docs")).isDirectory()).toBe(true);
  expect(statSync(join(mountPoint, "new.txt")).isFile()).toBe(true);

  unlinkSync(join(mountPoint, "new.txt"));
  rmdirSync(join(mountPoint, "docs"));

  await fs.unmount();
});
