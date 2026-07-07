import { defineConfig } from "vitest/config";
import path from "node:path";

// `node:sqlite` is a real Node built-in (22.5+) but it's not yet listed in
// `module.builtinModules`, so Vite tries to bundle it and fails. We short-
// circuit: resolve the id ourselves and `load` a tiny shim that pulls the
// genuine built-in via createRequire. Node loads it fine at runtime.
const nodeSqliteShim = {
  name: "node-sqlite-shim",
  enforce: "pre" as const,
  resolveId(id: string) {
    if (id === "node:sqlite" || id === "sqlite") return "\0node-sqlite-shim";
    return null;
  },
  load(id: string) {
    if (id === "\0node-sqlite-shim") {
      return `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite");
export const DatabaseSync = sqlite.DatabaseSync;
export default sqlite;`;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [nodeSqliteShim],
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
