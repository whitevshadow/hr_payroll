import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No path alias needed — all imports use relative paths for simplicity.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Dev: proxy same-origin /api (the app's default base) to the local
    // gateway, mirroring the nginx proxy used in the container image.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
