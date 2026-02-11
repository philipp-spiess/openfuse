/**
 * Idealized TypeScript API for FSKit (Apple's user-space file system framework)
 * This represents the full capability surface of FSKit, translated from the
 * native Swift/protobuf API into idiomatic TypeScript.
 */

// ─── Core Types ──────────────────────────────────────────────────────────────

export type ItemId = bigint;

export enum ItemType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  Symlink = 3,
  Fifo = 4,
  CharDevice = 5,
  BlockDevice = 6,
  Socket = 7,
}

export enum OpenMode {
  Read = 0,
  Write = 1,
}

export enum CaseFormat {
  /** Treats upper/lower case as distinct (e.g. FILE.txt ≠ file.txt) */
  Sensitive = 0,
  /** Case-insensitive (FILE.txt = file.txt) */
  Insensitive = 1,
  /** Case-insensitive but preserves original casing */
  InsensitiveCasePreserving = 2,
}

// ─── Item Attributes ─────────────────────────────────────────────────────────

export interface ItemAttributes {
  uid?: number;
  gid?: number;
  /** Permission bits (setuid, setgid, sticky, rwx) */
  mode?: number;
  type?: ItemType;
  linkCount?: number;
  /** BSD flags (see st_flags in stat.h) */
  flags?: number;
  /** File size in bytes */
  size?: bigint;
  /** Allocated size on disk */
  allocSize?: bigint;
  /** Unique file identifier. Reserved: 0=invalid, 1=parentOfRoot, 2=rootDir */
  fileId?: ItemId;
  /** Parent directory identifier */
  parentId?: ItemId;
  /** Whether this item only supports a limited set of xattrs */
  supportsLimitedXattrs?: boolean;
  /** Override per-volume kernel offloaded I/O for this specific file */
  inhibitKernelOffloadedIO?: boolean;

  // ── Timestamps ──
  /** Last content modification (mtime) */
  modifyTime?: Date;
  /** When added to parent directory */
  addedTime?: Date;
  /** Last metadata change (ctime) */
  changeTime?: Date;
  /** Last access time */
  accessTime?: Date;
  /** Creation time */
  birthTime?: Date;
  /** Last backup time */
  backupTime?: Date;
}

// ─── Item (a file, directory, symlink, etc.) ─────────────────────────────────

export interface Item {
  attributes: ItemAttributes;
  name: Buffer;
}

// ─── Directory Enumeration ───────────────────────────────────────────────────

export interface DirectoryEntry {
  item: Item;
  /** Opaque cookie pointing to the NEXT entry (for pagination) */
  nextCookie: bigint;
}

export interface DirectoryEntries {
  entries: DirectoryEntry[];
  /** Version token — changes when directory contents change */
  verifier: bigint;
}

// ─── Volume Statistics ───────────────────────────────────────────────────────

export interface VolumeStatistics {
  /** Block size in bytes (default 4096, must be > 0) */
  blockSize: number;
  /** Optimal I/O size (should be multiple of blockSize) */
  ioSize: number;
  totalBlocks?: bigint;
  availableBlocks?: bigint;
  freeBlocks?: bigint;
  usedBlocks?: bigint;
  totalBytes?: bigint;
  availableBytes?: bigint;
  freeBytes?: bigint;
  usedBytes?: bigint;
  /** Total file slots */
  totalFiles?: bigint;
  /** Free file slots */
  freeFiles?: bigint;
}

// ─── Volume Capabilities ─────────────────────────────────────────────────────

export interface VolumeCapabilities {
  supportsPersistentObjectIds?: boolean;
  supportsSymbolicLinks?: boolean;
  supportsHardLinks?: boolean;
  supportsJournal?: boolean;
  supportsActiveJournal?: boolean;
  doesNotSupportRootTimes?: boolean;
  supportsSparseFiles?: boolean;
  supportsZeroRuns?: boolean;
  supportsFastStatfs?: boolean;
  supports2TBFiles?: boolean;
  supportsOpenDenyModes?: boolean;
  supportsHiddenFiles?: boolean;
  doesNotSupportVolumeSizes?: boolean;
  supports64BitObjectIds?: boolean;
  supportsDocumentId?: boolean;
  doesNotSupportImmutableFiles?: boolean;
  doesNotSupportSettingFilePermissions?: boolean;
  supportsSharedSpace?: boolean;
  supportsVolumeGroups?: boolean;
  caseFormat?: CaseFormat;
}

// ─── Path Configuration ──────────────────────────────────────────────────────

export interface PathConfOperations {
  /** Max hard links per item (-1 = no limit) */
  maximumLinkCount: number;
  /** Max filename component length (-1 = no limit) */
  maximumNameLength: number;
  /** If true, only superuser can chown */
  restrictsOwnershipChanges: boolean;
  /** If true, truncates long names; if false, returns ENAMETOOLONG */
  truncatesLongNames: boolean;
  /** Max xattr size in bytes */
  maximumXattrSize?: number;
  /** Max file size in bytes */
  maximumFileSize?: bigint;
}

// ─── Volume Behavior (per-mount settings) ────────────────────────────────────

export enum ItemDeactivationPolicy {
  /** Always call deactivateItem */
  Always = 0,
  /** Only for open-unlinked items at last close */
  ForRemovedItems = 1,
  /** Only for files with preallocated space (trim-on-close) */
  ForPreallocatedItems = 2,
}

export interface VolumeBehavior {
  enableOpenUnlinkEmulation?: boolean;
  xattrOperationsInhibited?: boolean;
  openCloseInhibited?: boolean;
  accessCheckInhibited?: boolean;
  volumeRenameInhibited?: boolean;
  preallocateInhibited?: boolean;
  itemDeactivationOptions?: ItemDeactivationPolicy[];
}

// ─── Sync Flags ──────────────────────────────────────────────────────────────

export enum SyncFlags {
  None = 0,
  /** Blocking sync — wait for I/O completion */
  Wait = 1,
  /** Start I/O but don't wait */
  NoWait = 2,
  /** Data-integrity sync */
  DWait = 4,
}

// ─── Access Check ────────────────────────────────────────────────────────────

export enum AccessMask {
  ReadData = 0,
  ListDirectory = 1,
  WriteData = 2,
  AddFile = 3,
  Execute = 4,
  Search = 5,
  Delete = 6,
  AppendData = 7,
  AddSubdirectory = 8,
  DeleteChild = 9,
  ReadAttributes = 10,
  WriteAttributes = 11,
  ReadXattr = 12,
  WriteXattr = 13,
  ReadSecurity = 14,
  WriteSecurity = 15,
  TakeOwnership = 16,
}

// ─── Xattr Policy ────────────────────────────────────────────────────────────

export enum SetXattrPolicy {
  /** Set regardless of previous state */
  AlwaysSet = 0,
  /** Fail if xattr already exists */
  MustCreate = 1,
  /** Fail if xattr doesn't exist */
  MustReplace = 2,
  /** Delete the xattr */
  Delete = 3,
}

// ─── Preallocation ───────────────────────────────────────────────────────────

export enum PreallocateFlag {
  /** Allocate contiguous space */
  Contiguous = 0,
  /** All or nothing */
  All = 1,
  /** Space persists even after close(2) */
  Persist = 2,
  /** Allocate from physical EOF (ignores offset) */
  FromEOF = 3,
}

// ─── The File System Interface ───────────────────────────────────────────────
//
// This is the main thing you implement. All methods are optional except the
// ones in "Core Operations" — those are required for a functional filesystem.
//

export interface FileSystemHandlers {
  // ── Identity & Configuration (called once at startup) ──

  /** Return a unique resource identifier and optional name */
  getResourceIdentifier?(): { name?: string; containerId?: string };

  /** Return a unique volume identifier and display name */
  getVolumeIdentifier?(): { id?: string; name?: string };

  /** Declare volume behavior flags (inhibit protocols, deactivation policy) */
  getVolumeBehavior?(): VolumeBehavior;

  /** System limits: max links, name length, xattr size, file size */
  getPathConf?(): PathConfOperations;

  /** Declare what the volume supports: symlinks, hard links, case format, etc. */
  getCapabilities?(): VolumeCapabilities;

  /** Report volume size stats (total/free/used blocks and bytes) */
  getStatistics?(): VolumeStatistics;

  // ── Lifecycle ──

  /**
   * Called before mount. Allocate in-memory state, return the root directory item.
   * FSKit caches this root item for the lifetime of the volume.
   */
  activate?(options: string[]): Item;

  /** Called after unmount + reclaim. Release all resources. Don't do I/O here. */
  deactivate?(options: { force: boolean }): void;

  /** Mount the volume. Called after activate(). */
  mount?(options: string[]): void;

  /** Unmount. Flush and clear all cached state. */
  unmount?(): void;

  /** Flush pending I/O and metadata to the underlying resource. */
  synchronize?(flags: SyncFlags): void;

  // ── Core Operations (required for a functional filesystem) ──

  /**
   * Look up an item by name within a directory.
   * Return the item, or throw ENOENT if not found.
   * The returned name may differ from the input (case-insensitive FS, Unicode normalization).
   */
  lookup(name: Buffer, directoryId: ItemId): Item;

  /** Get attributes for an item. Set linkCount=1 if no hard links. */
  getAttributes(itemId: ItemId): ItemAttributes;

  /** Set attributes on an item. Ignore unsupported attrs without error. */
  setAttributes(itemId: ItemId, attributes: ItemAttributes): ItemAttributes;

  /**
   * Enumerate directory contents with pagination.
   * First call: cookie=0n, verifier=0n.
   * Pack entries with nextCookie values. Return a verifier that changes when dir changes.
   * Include "." and ".." entries unless attributes were requested.
   */
  enumerateDirectory(
    directoryId: ItemId,
    cookie: bigint,
    verifier: bigint,
  ): DirectoryEntries;

  /**
   * Release resources for an item the kernel no longer references.
   * Called exactly once per item returned from lookup/create/etc.
   */
  reclaimItem(itemId: ItemId): void;

  // ── Create / Delete ──

  /** Create a file or directory. Throw EEXIST if name already exists. */
  createItem?(
    name: Buffer,
    type: ItemType.File | ItemType.Directory,
    directoryId: ItemId,
    attributes: ItemAttributes,
  ): Item;

  /** Create a symbolic link. Throw EEXIST if name exists. */
  createSymbolicLink?(
    name: Buffer,
    directoryId: ItemId,
    attributes: ItemAttributes,
    contents: Buffer,
  ): Item;

  /**
   * Create a hard link to an existing item.
   * Throw EEXIST / EMLINK / ENOTSUP as appropriate.
   */
  createLink?(itemId: ItemId, name: Buffer, directoryId: ItemId): Item;

  /**
   * Remove an item name from a directory.
   * Don't deallocate the item itself — that happens in reclaimItem.
   */
  removeItem?(itemId: ItemId, name: Buffer, directoryId: ItemId): void;

  /**
   * Rename/move an item. If overItemId is set, replace that destination item.
   * Throw ENOTEMPTY if destination is a non-empty directory.
   */
  renameItem?(params: {
    itemId: ItemId;
    sourceDirectoryId: ItemId;
    sourceName: Buffer;
    destinationName: Buffer;
    destinationDirectoryId: ItemId;
    overItemId?: ItemId;
  }): void;

  // ── Read / Write ──

  /** Read a symbolic link's target path. */
  readSymbolicLink?(itemId: ItemId): Buffer;

  /**
   * Open a file. Called before read/write if OpenClose operations are enabled.
   * Receives the access modes being requested.
   */
  openItem?(itemId: ItemId, modes: OpenMode[]): void;

  /**
   * Close a file. `modes` indicates what access to KEEP after this close.
   * Empty modes = fully closed. Final close happens when all memory mappings release.
   */
  closeItem?(itemId: ItemId, modes: OpenMode[]): void;

  /**
   * Read bytes from a file.
   * If offset is past EOF, return empty buffer (not an error).
   * If fewer bytes available than requested, return what's there.
   */
  read?(itemId: ItemId, offset: bigint, length: bigint): Buffer;

  /**
   * Write bytes to a file. Allocate space as needed.
   * Throw ENOSPC if the volume is full.
   * Returns number of bytes actually written.
   */
  write?(itemId: ItemId, offset: bigint, contents: Buffer): bigint;

  // ── Extended Attributes ──

  /** List supported xattr names for an item (only for "limited" xattr support). */
  getSupportedXattrNames?(itemId: ItemId): Buffer[];

  /** Get a specific xattr value. */
  getXattr?(itemId: ItemId, name: Buffer): Buffer;

  /** Set/create/replace/delete an xattr based on policy. */
  setXattr?(
    itemId: ItemId,
    name: Buffer,
    value: Buffer | null,
    policy: SetXattrPolicy,
  ): void;

  /** List all xattr names currently set on an item. */
  listXattrs?(itemId: ItemId): Buffer[];

  // ── Access Control ──

  /** Check whether the FS allows the given access types on an item. Return true/false. */
  checkAccess?(itemId: ItemId, access: AccessMask[]): boolean;

  // ── Volume Management ──

  /** Rename the volume itself. */
  setVolumeName?(name: Buffer): void;

  // ── Preallocation ──

  /**
   * Preallocate disk space for a file without writing to it.
   * Improves perf for many-small-writes patterns and reduces fragmentation.
   * Returns the number of bytes actually allocated.
   */
  preallocateSpace?(
    itemId: ItemId,
    offset: bigint,
    length: bigint,
    flags: PreallocateFlag[],
  ): bigint;

  // ── Item Deactivation ──

  /**
   * Kernel is done with this item (equivalent to VFS VNOP_INACTIVE).
   * Optional — can defer to reclaimItem. Controlled by VolumeBehavior policy.
   */
  deactivateItem?(itemId: ItemId): void;
}

// ─── The Main API ────────────────────────────────────────────────────────────

export interface FileSystem {
  /** Mount the filesystem at the given path */
  mount(mountPoint: string): Promise<void>;

  /** Unmount and clean up */
  unmount(): Promise<void>;

  /** Whether the filesystem is currently mounted */
  readonly mounted: boolean;

  /** The path where the filesystem is mounted */
  readonly mountPoint: string | null;
}

/**
 * Create a user-space file system.
 *
 * On macOS 15.4+: uses FSKit via FSKitBridge
 * On Linux: uses FUSE (kernel built-in)
 * On Windows: uses ProjFS (built-in) or WinFsp
 *
 * @example
 * ```ts
 * import { createFileSystem } from "@aspect/fs";
 *
 * const fs = createFileSystem({
 *   getVolumeIdentifier: () => ({ name: "MyFS" }),
 *   getStatistics: () => ({ blockSize: 4096, ioSize: 4096, totalBytes: 1024n * 1024n * 100n }),
 *   getCapabilities: () => ({ supportsSymbolicLinks: true, caseFormat: CaseFormat.Sensitive }),
 *
 *   activate: () => ({
 *     name: Buffer.from(""),
 *     attributes: { type: ItemType.Directory, fileId: 2n, mode: 0o755 },
 *   }),
 *
 *   lookup(name, directoryId) {
 *     // Find item by name in directory
 *   },
 *
 *   getAttributes(itemId) {
 *     // Return file metadata
 *   },
 *
 *   setAttributes(itemId, attrs) {
 *     // Update file metadata
 *   },
 *
 *   enumerateDirectory(directoryId, cookie, verifier) {
 *     // List directory contents with pagination
 *   },
 *
 *   reclaimItem(itemId) {
 *     // Free resources for this item
 *   },
 *
 *   read(itemId, offset, length) {
 *     // Read file contents
 *   },
 *
 *   write(itemId, offset, contents) {
 *     // Write file contents
 *   },
 * });
 *
 * await fs.mount("/Volumes/MyFS");
 * // Your filesystem is now visible in Finder!
 * ```
 */
export function createFileSystem(handlers: FileSystemHandlers): FileSystem;
