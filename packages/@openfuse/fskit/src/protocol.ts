import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import protobuf from "protobufjs";

const require = createRequire(import.meta.url);
const PROTO_PATH = new URL("./protocol.proto", import.meta.url).pathname;

let requestType: protobuf.Type | null = null;
let responseType: protobuf.Type | null = null;

function normalizeOutgoing(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeOutgoing(entry));
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeOutgoing(entry);
    }

    return normalized;
  }

  return value;
}

function normalizeIncoming(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeIncoming(entry));
  }

  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      normalized[key] = normalizeIncoming(entry);
    }

    return normalized;
  }

  return value;
}

function loadProtocolTypes(): { request: protobuf.Type; response: protobuf.Type } {
  if (requestType && responseType) {
    return { request: requestType, response: responseType };
  }

  const protobufRoot = new protobuf.Root();
  const protobufPackagePath = dirname(require.resolve("protobufjs/package.json"));

  protobufRoot.resolvePath = (origin, target) => {
    if (target.startsWith("google/protobuf/")) {
      return join(protobufPackagePath, target);
    }

    if (!origin) {
      return target;
    }

    return join(dirname(origin), target);
  };

  protobufRoot.loadSync(PROTO_PATH, { keepCase: true });

  requestType = protobufRoot.lookupType("pb.Request");
  responseType = protobufRoot.lookupType("pb.Response");

  return { request: requestType, response: responseType };
}

export type ProtocolRequest = Record<string, unknown>;
export type ProtocolResponse = Record<string, unknown>;

export function encodeRequest(message: ProtocolRequest): Buffer {
  const { request } = loadProtocolTypes();
  const normalized = normalizeOutgoing(message) as Record<string, unknown>;
  const err = request.verify(normalized);

  if (err) {
    throw new Error(`openfuse/fskit: invalid request payload: ${err}`);
  }

  const encoded = request.encode(request.create(normalized)).finish();
  return Buffer.from(encoded);
}

export function decodeResponse(buffer: Buffer): ProtocolResponse {
  const { response } = loadProtocolTypes();
  const decoded = response.decode(buffer);

  return normalizeIncoming(
    response.toObject(decoded, {
      longs: String,
      bytes: Buffer,
      enums: String,
      defaults: false,
      arrays: true,
      objects: true,
    }),
  ) as ProtocolResponse;
}
