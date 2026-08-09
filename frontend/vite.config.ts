import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// No path alias needed — all imports use relative paths for simplicity.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Routes are lazy-loaded (see App.tsx), so page code already splits.
        // These pin the big shared libraries into their own long-lived chunks
        // instead of letting them duplicate across page chunks or get dragged
        // into the entry: `xlsx` and `recharts` are each larger than the rest
        // of the app put together, and only a few screens use them.
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query", "@tanstack/react-virtual"],
          "vendor-motion": ["framer-motion"],
          "vendor-charts": ["recharts"],
          "vendor-xlsx": ["xlsx"],
          "vendor-dates": ["date-fns"],
          // `clsx` must be pinned here explicitly. recharts depends on it, so
          // without its own entry Rollup folds the shared clsx module into
          // vendor-charts — and because the app shell uses clsx everywhere,
          // that made the entry statically import all 411 kB of recharts for
          // one 200-byte helper.
          //
          // These three are genuinely in the eager graph: clsx and axios
          // everywhere, zod via usePayrollSSE -> lib/schemas in the AppShell.
          // date-fns is not (two lazy pages only), so it is split out above.
          "vendor-utils": ["clsx", "zod", "axios"],
          // lucide-react tree-shakes to one module per icon, which Rollup was
          // emitting as ~24 separate sub-kilobyte chunks — 24 extra requests
          // for ~12 kB total. One shared chunk is a single cached request.
          "vendor-icons": ["lucide-react"],
        },
      },
    },
    // The xlsx chunk trips the default 500 kB warning on its own; the point of
    // splitting it out is that it is never in the initial download.
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: true,
    port: 4050,
    // Dev: proxy same-origin /api (the app's default base) to the local
    // gateway, mirroring the nginx proxy used in the container image.
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
