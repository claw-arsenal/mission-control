import { createServer } from "vite";
import { resolve } from "node:path";

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: resolve(root, "node_modules/.vite-audit"),
  resolve: { alias: [
    { find: "@/components/modules/modules-provider", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "next/navigation", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "next/link", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "@", replacement: root },
  ] },
  server: { host: "127.0.0.1", port: 4174, strictPort: true, watch: { ignored: ["**/.next/**", "**/.git/**"] } },
});
await server.listen();
console.log("Audit fixtures: http://127.0.0.1:4174/tests/previews/audit.html");
