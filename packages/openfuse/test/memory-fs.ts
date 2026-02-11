import {
  EEXIST,
  EISDIR,
  ENOENT,
  ENOTDIR,
  ENOTEMPTY,
  PosixError,
} from "../src/errors";
import {
  ItemType,
  type DirectoryEntries,
  type FileSystemHandlers,
  type Item,
  type ItemAttributes,
} from "../src/types";

const ROOT_ITEM_ID = 2n;

interface BaseNode {
  id: bigint;
  name: string;
  parentId: bigint | null;
  mode: number;
  uid?: number;
  gid?: number;
  createTime: Date;
  modifyTime: Date;
  accessTime: Date;
  linkCount: number;
}

interface FileNode extends BaseNode {
  type: ItemType.File;
  content: Buffer;
}

interface DirectoryNode extends BaseNode {
  type: ItemType.Directory;
  children: Map<string, bigint>;
}

type Node = FileNode | DirectoryNode;

export interface MemoryFileSystemOptions {
  uid?: number;
  gid?: number;
  rootMode?: number;
  readdirPageSize?: number;
}

export class MemoryFileSystem implements FileSystemHandlers {
  private readonly nodes = new Map<bigint, Node>();
  private nextId = ROOT_ITEM_ID + 1n;
  private readonly uid?: number;
  private readonly gid?: number;
  private readonly readdirPageSize: number;

  constructor(options: MemoryFileSystemOptions = {}) {
    this.uid = options.uid;
    this.gid = options.gid;
    this.readdirPageSize = options.readdirPageSize ?? 128;

    const now = new Date();
    const root: DirectoryNode = {
      id: ROOT_ITEM_ID,
      type: ItemType.Directory,
      name: "",
      parentId: null,
      mode: options.rootMode ?? 0o755,
      uid: this.uid,
      gid: this.gid,
      createTime: now,
      modifyTime: now,
      accessTime: now,
      linkCount: 1,
      children: new Map(),
    };

    this.nodes.set(root.id, root);
  }

  activate(): Item {
    return this.toItem(this.getNode(ROOT_ITEM_ID));
  }

  deactivate(): void {
    // In-memory fixture has no external resources to release.
  }

  lookup(name: string, directoryId: bigint): Item {
    const directory = this.getDirectory(directoryId);
    const itemId = directory.children.get(name);

    if (!itemId) {
      throw ENOENT(`ENOENT: ${name}`);
    }

    return this.toItem(this.getNode(itemId));
  }

  getAttributes(itemId: bigint): ItemAttributes {
    return this.toAttributes(this.getNode(itemId));
  }

  readdir(directoryId: bigint, cookie: bigint): DirectoryEntries {
    const directory = this.getDirectory(directoryId);
    const items = [...directory.children.values()].map((id) => this.getNode(id));
    const startIndex = Number(cookie);

    if (!Number.isFinite(startIndex) || startIndex < 0) {
      throw new PosixError("EINVAL", `EINVAL: invalid cookie ${cookie}`);
    }

    const selected = items.slice(startIndex, startIndex + this.readdirPageSize);

    return {
      entries: selected.map((node, index) => {
        const absoluteIndex = startIndex + index;
        const hasMore = absoluteIndex + 1 < items.length;

        return {
          item: this.toItem(node),
          nextCookie: hasMore ? BigInt(absoluteIndex + 1) : 0n,
        };
      }),
    };
  }

  read(itemId: bigint, offset: bigint, length: bigint): Buffer {
    const file = this.getFile(itemId);
    const start = Number(offset);
    const span = Number(length);

    if (start < 0 || span < 0 || !Number.isFinite(start) || !Number.isFinite(span)) {
      throw new PosixError("EINVAL", "EINVAL: invalid read range");
    }

    file.accessTime = new Date();

    if (start >= file.content.length) {
      return Buffer.alloc(0);
    }

    const end = Math.min(file.content.length, start + span);
    return Buffer.from(file.content.subarray(start, end));
  }

  write(itemId: bigint, offset: bigint, data: Buffer): bigint {
    const file = this.getFile(itemId);
    const start = Number(offset);

    if (start < 0 || !Number.isFinite(start)) {
      throw new PosixError("EINVAL", "EINVAL: invalid write offset");
    }

    const neededLength = start + data.length;

    if (neededLength > file.content.length) {
      const expanded = Buffer.alloc(neededLength);
      file.content.copy(expanded, 0, 0, file.content.length);
      file.content = expanded;
    }

    data.copy(file.content, start);
    file.modifyTime = new Date();
    file.accessTime = new Date();

    return BigInt(data.length);
  }

  create(name: string, type: ItemType, directoryId: bigint, mode: number): Item {
    const directory = this.getDirectory(directoryId);

    if (directory.children.has(name)) {
      throw EEXIST(`EEXIST: ${name}`);
    }

    const now = new Date();
    const id = this.nextId++;

    let node: Node;

    switch (type) {
      case ItemType.File:
        node = {
          id,
          type,
          name,
          parentId: directoryId,
          mode,
          uid: this.uid,
          gid: this.gid,
          createTime: now,
          modifyTime: now,
          accessTime: now,
          linkCount: 1,
          content: Buffer.alloc(0),
        };
        break;
      case ItemType.Directory:
        node = {
          id,
          type,
          name,
          parentId: directoryId,
          mode,
          uid: this.uid,
          gid: this.gid,
          createTime: now,
          modifyTime: now,
          accessTime: now,
          linkCount: 1,
          children: new Map(),
        };
        break;
      case ItemType.Symlink:
        throw new PosixError("ENOSYS", "ENOSYS: symlink creation is not implemented in memory fixture");
      default:
        throw new PosixError("EINVAL", `EINVAL: unsupported item type ${type}`);
    }

    directory.children.set(name, id);
    directory.modifyTime = now;
    this.nodes.set(id, node);

    return this.toItem(node);
  }

  remove(name: string, directoryId: bigint): void {
    const directory = this.getDirectory(directoryId);
    const itemId = directory.children.get(name);

    if (!itemId) {
      throw ENOENT(`ENOENT: ${name}`);
    }

    const node = this.getNode(itemId);

    if (node.type === ItemType.Directory && node.children.size > 0) {
      throw ENOTEMPTY(`ENOTEMPTY: ${name}`);
    }

    directory.children.delete(name);
    directory.modifyTime = new Date();
    this.nodes.delete(node.id);
  }

  private getNode(itemId: bigint): Node {
    const node = this.nodes.get(itemId);

    if (!node) {
      throw ENOENT(`ENOENT: item id ${itemId}`);
    }

    return node;
  }

  private getDirectory(itemId: bigint): DirectoryNode {
    const node = this.getNode(itemId);

    if (node.type !== ItemType.Directory) {
      throw ENOTDIR(`ENOTDIR: item id ${itemId}`);
    }

    return node;
  }

  private getFile(itemId: bigint): FileNode {
    const node = this.getNode(itemId);

    if (node.type !== ItemType.File) {
      throw EISDIR(`EISDIR: item id ${itemId}`);
    }

    return node;
  }

  private toItem(node: Node): Item {
    return {
      id: node.id,
      name: node.name,
      attributes: this.toAttributes(node),
    };
  }

  private toAttributes(node: Node): ItemAttributes {
    return {
      type: node.type,
      size: node.type === ItemType.File ? BigInt(node.content.length) : 0n,
      mode: node.mode,
      uid: node.uid,
      gid: node.gid,
      modifyTime: new Date(node.modifyTime),
      accessTime: new Date(node.accessTime),
      createTime: new Date(node.createTime),
      linkCount: node.linkCount,
    };
  }
}

export function createMemoryFileSystem(options: MemoryFileSystemOptions = {}): MemoryFileSystem {
  return new MemoryFileSystem(options);
}
