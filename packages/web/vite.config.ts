import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { defineConfig } from "vite";

/** API real (`packages/api`, porta 3001 por padrão em `src/config.ts`). */
const API_ALVO = process.env.VITE_API_URL_PROXY ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react(), tailwind()],
  /** `.env` único na raiz do monorepo, como manda o AGENTS.md. */
  envDir: path.resolve(import.meta.dirname, "../.."),
  /**
   * `DEMO_MODE` é lida sem o prefixo `VITE_` porque é a mesma variável que a
   * API usa; nenhuma outra variável sem prefixo entra no bundle.
   */
  envPrefix: ["VITE_", "DEMO_MODE"],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 3000,
    proxy: {
      // O front chama `/api/...`; a API serve na raiz (`/auth/login`, `/agenda`).
      "/api": {
        target: API_ALVO,
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ""),
      },
    },
  },
});
