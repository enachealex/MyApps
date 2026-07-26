import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Web build is served from https://myapps.thejumpvault.com/oncall/. That is a
 * custom domain, so the site root is "/" — not "/MyApps/", which is only the
 * path when serving from the default github.io URL.
 * Native builds load from the device filesystem, so they need relative paths.
 * `npm run build:app` sets CAP_BUILD and switches the base accordingly.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.CAP_BUILD ? "./" : "/oncall/",
});
