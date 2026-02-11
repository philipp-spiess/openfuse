import {
  ItemType,
  createFileSystem,
  type FileSystemHandlers,
  type Item,
  type ItemAttributes,
} from "openfuse";

interface MemoryNodeBase {
  id: bigint;
  name: string;
  mode: number;
  createTime: Date;
  modifyTime: Date;
  accessTime: Date;
}

interface MemoryFileNode extends MemoryNodeBase {
  type: ItemType.File;
  content: Buffer;
}

interface MemoryDirectoryNode extends MemoryNodeBase {
  type: ItemType.Directory;
  children: Map<string, bigint>;
}

type MemoryNode = MemoryFileNode | MemoryDirectoryNode;

function createMemoryHandlers(): FileSystemHandlers {
  const rootId = 2n;
  const nodes = new Map<bigint, MemoryNode>();
  let nextId = 3n;

  const root: MemoryDirectoryNode = {
    id: rootId,
    type: ItemType.Directory,
    name: "",
    mode: 0o755,
    createTime: new Date(),
    modifyTime: new Date(),
    accessTime: new Date(),
    children: new Map(),
  };

  nodes.set(rootId, root);

  const getNode = (id: bigint): MemoryNode => {
    const node = nodes.get(id);
    if (!node) {
      throw new Error(`ENOENT: ${id}`);
    }
    return node;
  };

  const getDir = (id: bigint): MemoryDirectoryNode => {
    const node = getNode(id);
    if (node.type !== ItemType.Directory) {
      throw new Error(`ENOTDIR: ${id}`);
    }
    return node;
  };

  const toAttributes = (node: MemoryNode): ItemAttributes => ({
    type: node.type,
    size: node.type === ItemType.File ? BigInt(node.content.length) : 0n,
    mode: node.mode,
    modifyTime: node.modifyTime,
    accessTime: node.accessTime,
    createTime: node.createTime,
    linkCount: 1,
  });

  const toItem = (node: MemoryNode): Item => ({
    id: node.id,
    name: node.name,
    attributes: toAttributes(node),
  });

  return {
    activate() {
      return toItem(root);
    },
    lookup(name, directoryId) {
      const directory = getDir(directoryId);
      const itemId = directory.children.get(name);
      if (!itemId) {
        throw new Error(`ENOENT: ${name}`);
      }
      return toItem(getNode(itemId));
    },
    getAttributes(itemId) {
      return toAttributes(getNode(itemId));
    },
    readdir(directoryId, cookie) {
      const directory = getDir(directoryId);
      const items = [...directory.children.values()].map((id) => getNode(id));
      const start = Number(cookie);
      const page = items.slice(start, start + 128);
      return {
        entries: page.map((node, index) => {
          const absoluteIndex = start + index;
          const hasMore = absoluteIndex + 1 < items.length;
          return {
            item: toItem(node),
            nextCookie: hasMore ? BigInt(absoluteIndex + 1) : 0n,
          };
        }),
      };
    },
    read(itemId, offset, length) {
      const node = getNode(itemId);
      if (node.type !== ItemType.File) {
        throw new Error(`EISDIR: ${itemId}`);
      }
      return node.content.subarray(Number(offset), Number(offset + length));
    },
    write(itemId, offset, data) {
      const node = getNode(itemId);
      if (node.type !== ItemType.File) {
        throw new Error(`EISDIR: ${itemId}`);
      }
      const start = Number(offset);
      const end = start + data.length;
      if (end > node.content.length) {
        const expanded = Buffer.alloc(end);
        node.content.copy(expanded, 0, 0, node.content.length);
        node.content = expanded;
      }
      data.copy(node.content, start);
      node.modifyTime = new Date();
      return BigInt(data.length);
    },
    create(name, type, directoryId, mode) {
      const directory = getDir(directoryId);
      if (directory.children.has(name)) {
        throw new Error(`EEXIST: ${name}`);
      }
      const id = nextId++;
      const now = new Date();
      let node: MemoryNode;

      if (type === ItemType.File) {
        node = {
          id,
          type: ItemType.File,
          name,
          mode,
          content: Buffer.alloc(0),
          createTime: now,
          modifyTime: now,
          accessTime: now,
        };
      } else {
        node = {
          id,
          type: ItemType.Directory,
          name,
          mode,
          children: new Map(),
          createTime: now,
          modifyTime: now,
          accessTime: now,
        };
      }

      nodes.set(id, node);
      directory.children.set(name, id);
      directory.modifyTime = now;
      return toItem(node);
    },
    remove(name, directoryId) {
      const directory = getDir(directoryId);
      const itemId = directory.children.get(name);
      if (!itemId) {
        throw new Error(`ENOENT: ${name}`);
      }
      const node = getNode(itemId);
      if (node.type === ItemType.Directory && node.children.size > 0) {
        throw new Error(`ENOTEMPTY: ${name}`);
      }
      nodes.delete(itemId);
      directory.children.delete(name);
      directory.modifyTime = new Date();
    },
    deactivate() {
      // No-op for in-memory data.
    },
  };
}

async function main(): Promise<void> {
  const fs = createFileSystem(createMemoryHandlers());
  const mountPoint = "/tmp/openfuse-memory";

  await fs.mount(mountPoint);
  console.log(`Mounted memory filesystem at ${mountPoint}`);

  process.on("SIGINT", async () => {
    await fs.unmount();
    console.log("Unmounted");
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
