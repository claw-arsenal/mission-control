import { createServer } from "vite";
const server = await createServer({ configFile: false, root: process.cwd(),
  resolve: { alias: { "@": process.cwd() } },
  server: { host: "127.0.0.1", port: 4176, strictPort: true, watch: { ignored: ["**/.next/**", "**/.git/**"] } },
});
await server.listen();
console.log("Review settings fixture: http://127.0.0.1:4176/tests/previews/review-settings.html");
