import { beforeEach, describe, expect, test } from "bun:test";

import { PosixError } from "../src/errors";
import { ItemType } from "../src/types";
import { createMemoryFileSystem, type MemoryFileSystem } from "./memory-fs";

function expectPosixErrorCode(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error("expected a PosixError");
  } catch (error) {
    expect(error).toBeInstanceOf(PosixError);
    expect((error as PosixError).code).toBe(code);
  }
}

describe("core: MemoryFileSystem", () => {
  let memoryFs: MemoryFileSystem;
  let rootId: bigint;

  beforeEach(() => {
    memoryFs = createMemoryFileSystem({ readdirPageSize: 2 });
    rootId = memoryFs.activate().id;
  });

  test("creates files and directories and supports lookup", () => {
    const docs = memoryFs.create("docs", ItemType.Directory, rootId, 0o755);
    const readme = memoryFs.create("README.md", ItemType.File, docs.id, 0o644);

    const resolvedDocs = memoryFs.lookup("docs", rootId);
    const resolvedReadme = memoryFs.lookup("README.md", docs.id);

    expect(resolvedDocs.id).toBe(docs.id);
    expect(resolvedReadme.id).toBe(readme.id);

    expectPosixErrorCode(() => memoryFs.lookup("missing.txt", rootId), "ENOENT");
  });

  test("reads and writes file content with size updates", () => {
    const notes = memoryFs.create("notes.txt", ItemType.File, rootId, 0o644);

    const bytesWritten = memoryFs.write(notes.id, 0n, Buffer.from("hello"));
    expect(bytesWritten).toBe(5n);

    const bytesWrittenAtOffset = memoryFs.write(notes.id, 6n, Buffer.from("world"));
    expect(bytesWrittenAtOffset).toBe(5n);

    const content = memoryFs.read(notes.id, 0n, 11n);
    expect(content.toString("utf8")).toBe("hello\u0000world");

    const attrs = memoryFs.getAttributes(notes.id);
    expect(attrs.size).toBe(11n);
  });

  test("readdir supports cookie-based pagination", () => {
    memoryFs.create("a.txt", ItemType.File, rootId, 0o644);
    memoryFs.create("b.txt", ItemType.File, rootId, 0o644);
    memoryFs.create("c.txt", ItemType.File, rootId, 0o644);

    const page1 = memoryFs.readdir(rootId, 0n);
    expect(page1.entries.length).toBe(2);
    expect(page1.entries[0]?.item.name).toBe("a.txt");
    expect(page1.entries[1]?.item.name).toBe("b.txt");
    expect(page1.entries[1]?.nextCookie).toBe(2n);

    const page2 = memoryFs.readdir(rootId, page1.entries[1]!.nextCookie);
    expect(page2.entries.length).toBe(1);
    expect(page2.entries[0]?.item.name).toBe("c.txt");
    expect(page2.entries[0]?.nextCookie).toBe(0n);
  });

  test("remove deletes files and empty directories", () => {
    const tmp = memoryFs.create("tmp", ItemType.Directory, rootId, 0o755);
    const child = memoryFs.create("child.txt", ItemType.File, tmp.id, 0o644);

    memoryFs.remove("child.txt", tmp.id);
    expectPosixErrorCode(() => memoryFs.lookup("child.txt", tmp.id), "ENOENT");

    memoryFs.remove("tmp", rootId);
    expectPosixErrorCode(() => memoryFs.lookup("tmp", rootId), "ENOENT");

    expectPosixErrorCode(() => memoryFs.remove("tmp", rootId), "ENOENT");

    const withChild = memoryFs.create("with-child", ItemType.Directory, rootId, 0o755);
    memoryFs.create("nested", ItemType.File, withChild.id, 0o644);
    expectPosixErrorCode(() => memoryFs.remove("with-child", rootId), "ENOTEMPTY");

    // Ensure the path still exists after the failed remove.
    expect(memoryFs.lookup("with-child", rootId).id).toBe(withChild.id);
    expect(child.id > 0n).toBe(true);
  });

  test("create enforces EEXIST", () => {
    memoryFs.create("dup", ItemType.File, rootId, 0o644);
    expectPosixErrorCode(() => memoryFs.create("dup", ItemType.File, rootId, 0o644), "EEXIST");
  });

  test("attributes preserve mode and update timestamps on write", () => {
    const file = memoryFs.create("meta.txt", ItemType.File, rootId, 0o600);
    const initial = memoryFs.getAttributes(file.id);

    memoryFs.write(file.id, 0n, Buffer.from("abc"));

    const updated = memoryFs.getAttributes(file.id);
    expect(initial.mode).toBe(0o600);
    expect(updated.mode).toBe(0o600);
    expect(updated.size).toBe(3n);
    expect(updated.modifyTime?.getTime()).toBeGreaterThanOrEqual(
      initial.modifyTime?.getTime() ?? 0,
    );
    expect(updated.createTime?.getTime()).toBe(initial.createTime?.getTime());
  });
});
