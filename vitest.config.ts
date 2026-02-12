import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/openfuse/test/*.test.ts"],
  },
});
