import { createServer } from "vite";
import { resolve } from "node:path";

// Serves the boards fixture with sample data: no database, no auth, no network.
const root = process.cwd();
const shim = resolve(root, "tests/previews/boards-platform.tsx");
const server = await createServer({
  configFile: false,
  root,
  // Its own dep cache: the audit fixture server uses a different alias set,
  // and a shared cache makes both servers re-optimize on every switch.
  cacheDir: resolve(root, "node_modules/.vite-boards"),
  resolve: {
    alias: [
      { find: "@/components/modules/modules-provider", replacement: shim },
      { find: "@/hooks/use-auth", replacement: shim },
      { find: "next/navigation", replacement: shim },
      { find: "next/link", replacement: shim },
      { find: "next/image", replacement: resolve(root, "tests/previews/next-image.tsx") },
      { find: "@", replacement: root },
    ],
  },
  server: { host: "127.0.0.1", port: 4175, strictPort: true, watch: { ignored: ["**/.next/**", "**/.git/**"] } },
});
await server.listen();
console.log("Boards fixture: http://127.0.0.1:4175/tests/previews/boards.html");
console.log("Page fixtures:  http://127.0.0.1:4175/tests/previews/pages.html");
