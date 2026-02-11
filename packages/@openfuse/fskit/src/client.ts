import { Socket, createConnection } from "node:net";

import { decodeResponse, encodeRequest } from "./protocol";

export interface FSKitClientOptions {
  host?: string;
  port?: number;
  connectTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
}

export class FSKitTcpClient {
  private readonly host: string;
  private readonly port: number;
  private readonly connectTimeoutMs: number;

  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  constructor(options: FSKitClientOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 35367;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2_000;
  }

  get connected(): boolean {
    return this.socket !== null;
  }

  async connect(): Promise<void> {
    if (this.socket) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        reject(new Error("openfuse/fskit: connection to FSKitBridge timed out"));
      }, this.connectTimeoutMs);

      socket.once("connect", () => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        this.socket = socket;
        this.attachSocketListeners(socket);
        resolve();
      });

      socket.once("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.socket) {
      return;
    }

    const socket = this.socket;
    this.socket = null;

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });

    this.failAllPending(new Error("openfuse/fskit: disconnected"));
  }

  async request(contentKey: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.socket) {
      throw new Error("openfuse/fskit: client is not connected");
    }

    const requestId = this.nextRequestId++;
    const requestPayload = {
      id: requestId,
      [contentKey]: payload,
    };

    const body = encodeRequest(requestPayload);
    const frame = Buffer.allocUnsafe(4 + body.length);
    frame.writeUInt32BE(body.length, 0);
    body.copy(frame, 4);

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.socket?.write(frame, (error) => {
        if (error) {
          this.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  private attachSocketListeners(socket: Socket): void {
    socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.processFrames();
    });

    socket.on("error", (error) => {
      this.failAllPending(error);
    });

    socket.on("close", () => {
      this.socket = null;
      this.failAllPending(new Error("openfuse/fskit: socket closed"));
    });
  }

  private processFrames(): void {
    while (this.buffer.length >= 4) {
      const bodyLength = this.buffer.readUInt32BE(0);
      const frameLength = 4 + bodyLength;

      if (this.buffer.length < frameLength) {
        return;
      }

      const body = this.buffer.subarray(4, frameLength);
      this.buffer = this.buffer.subarray(frameLength);

      const response = decodeResponse(body);
      const requestId = Number(response.request_id ?? 0);
      const pending = this.pending.get(requestId);

      if (!pending) {
        continue;
      }

      this.pending.delete(requestId);
      pending.resolve(response);
    }
  }

  private failAllPending(error: unknown): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }

    this.pending.clear();
  }
}
