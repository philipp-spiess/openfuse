export enum ItemType {
  File = 1,
  Directory = 2,
  Symlink = 3,
}

export interface ItemAttributes {
  type: ItemType;
  size: bigint;
  mode: number;
  uid?: number;
  gid?: number;
  modifyTime?: Date;
  accessTime?: Date;
  createTime?: Date;
  linkCount?: number;
}

export interface Item {
  id: bigint;
  name: string;
  attributes: ItemAttributes;
}

export interface DirectoryEntry {
  item: Item;
  nextCookie: bigint;
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

export interface Backend {
  mount(mountPoint: string, handlers: FileSystemHandlers): Promise<void>;
  unmount(): Promise<void>;
}
