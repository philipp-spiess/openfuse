import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const sourceFile = resolve(packageDir, "src/bridge/fuse_bridge.c");

const requireBridge = process.env.OPENFUSE_REQUIRE_BRIDGE === "1";

if (process.platform !== "linux") {
  if (requireBridge) {
    console.error("[openfuse/fuse] bridge build is required but only supported on Linux");
    process.exit(1);
  }

  console.log(`[openfuse/fuse] skipping bridge build on platform ${process.platform}`);
  process.exit(0);
}

if (process.env.OPENFUSE_SKIP_BRIDGE_BUILD === "1") {
  console.log("[openfuse/fuse] skipping bridge build (OPENFUSE_SKIP_BRIDGE_BUILD=1)");
  process.exit(0);
}

const outputs = [
  resolve(packageDir, "src/bridge/fuse_bridge.so"),
  resolve(packageDir, "dist/bridge/fuse_bridge.so"),
];

for (const outputFile of outputs) {
  mkdirSync(dirname(outputFile), { recursive: true });

  const command = `cc -shared -o "${outputFile}" "${sourceFile}" $(pkg-config --cflags --libs fuse) -fPIC -pthread`;
  const result = spawnSync("bash", ["-lc", command], { stdio: "inherit" });

  if (result.status !== 0) {
    console.error(`[openfuse/fuse] failed to build bridge: ${outputFile}`);
    process.exit(result.status ?? 1);
  }
}

console.log("[openfuse/fuse] built fuse bridge for Bun FFI");
