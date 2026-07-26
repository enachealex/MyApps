import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Web build is served from https://enachealex.github.io/MyApps/oncall/
 * Native builds load from the device filesystem, so they need relative paths.
 * `npm run build:app` sets CAP_BUILD and switches the base accordingly.
 */
export default defineConfig({
  plugins: [react()],
  base: process.env.CAP_BUILD ? "./" : "/MyApps/oncall/",
});
