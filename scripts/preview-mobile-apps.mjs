import { createServer } from "vite";
import { resolve } from "node:path";

// Local fixture preview: no store credentials, database, or production requests.
const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  resolve: { alias: [
    { find: "@/components/modules/modules-provider", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "next/navigation", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "next/link", replacement: resolve(root, "tests/previews/platform.tsx") },
    { find: "@", replacement: root },
  ] },
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
});
await server.listen();
console.log("Mobile Applications preview: http://127.0.0.1:4173/tests/previews/mobile-apps.html");
