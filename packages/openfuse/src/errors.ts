const POSIX_ERRNO = {
  EBUSY: 16,
  EEXIST: 17,
  EINVAL: 22,
  EISDIR: 21,
  ENOENT: 2,
  ENOSPC: 28,
  ENOSYS: 38,
  ENOTDIR: 20,
  ENOTEMPTY: 39,
  EPERM: 1,
} as const;

export type PosixErrorCode = keyof typeof POSIX_ERRNO;

export class PosixError extends Error {
  public readonly code: PosixErrorCode;
  public readonly errno: number;

  constructor(code: PosixErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PosixError";
    this.code = code;
    this.errno = POSIX_ERRNO[code];
  }
}

export function createPosixError(code: PosixErrorCode, message?: string): PosixError {
  return new PosixError(code, message);
}

export function isPosixError(error: unknown, code?: PosixErrorCode): error is PosixError {
  if (!(error instanceof PosixError)) {
    return false;
  }

  return code ? error.code === code : true;
}

export function EBUSY(message?: string): PosixError {
  return createPosixError("EBUSY", message);
}

export function EEXIST(message?: string): PosixError {
  return createPosixError("EEXIST", message);
}

export function EINVAL(message?: string): PosixError {
  return createPosixError("EINVAL", message);
}

export function EISDIR(message?: string): PosixError {
  return createPosixError("EISDIR", message);
}

export function ENOENT(message?: string): PosixError {
  return createPosixError("ENOENT", message);
}

export function ENOSPC(message?: string): PosixError {
  return createPosixError("ENOSPC", message);
}

export function ENOSYS(message?: string): PosixError {
  return createPosixError("ENOSYS", message);
}

export function ENOTDIR(message?: string): PosixError {
  return createPosixError("ENOTDIR", message);
}

export function ENOTEMPTY(message?: string): PosixError {
  return createPosixError("ENOTEMPTY", message);
}

export function EPERM(message?: string): PosixError {
  return createPosixError("EPERM", message);
}
