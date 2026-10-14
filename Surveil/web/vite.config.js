import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the Surveil server from "/" (not under myapps.../surveil/), so
// base stays "/". In dev, API calls are proxied to the server on :8080.
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: false },
    },
  },
});
