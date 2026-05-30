import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No path alias needed — all imports use relative paths for simplicity.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
});
