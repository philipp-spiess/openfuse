import type { FileSystemHandlers } from "./index";

export function resolvePath(
  path: string,
  rootId: bigint,
  handlers: FileSystemHandlers,
): { itemId: bigint; parentId: bigint; name: string } {
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { itemId: rootId, parentId: rootId, name: "" };
  }

  let currentId = rootId;
  for (let i = 0; i < parts.length - 1; i++) {
    const item = handlers.lookup(parts[i]!, currentId);
    currentId = item.id;
  }

  const name = parts[parts.length - 1]!;
  const item = handlers.lookup(name, currentId);

  return { itemId: item.id, parentId: currentId, name };
}

export function resolveParent(
  path: string,
  rootId: bigint,
  handlers: FileSystemHandlers,
): { parentId: bigint; name: string } {
  const parts = path.split("/").filter(Boolean);

  if (parts.length === 0) {
    return { parentId: rootId, name: "" };
  }

  let currentId = rootId;
  for (let i = 0; i < parts.length - 1; i++) {
    const item = handlers.lookup(parts[i]!, currentId);
    currentId = item.id;
  }

  return { parentId: currentId, name: parts[parts.length - 1]! };
}

export function toErrno(error: unknown): number {
  if (
    error &&
    typeof error === "object" &&
    "errno" in error &&
    typeof (error as { errno: number }).errno === "number"
  ) {
    return -(error as { errno: number }).errno;
  }
  return -5; // EIO
}
