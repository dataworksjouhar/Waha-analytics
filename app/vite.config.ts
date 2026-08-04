import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" makes the built asset paths relative, so the dashboard works
// whether it is served from a domain root or from a project subpath on a
// static host. Data files are fetched with import.meta.env.BASE_URL rather
// than a hardcoded leading slash for the same reason (see src/lib/data.ts).
export default defineConfig({
  base: "./",
  plugins: [react()],
});
