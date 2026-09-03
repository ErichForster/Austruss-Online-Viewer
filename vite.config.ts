import { defineConfig } from "vite";
import path from "node:path";

// GitHub Pages serves a project site at <username>.github.io/<repo-name>/,
// so every asset URL needs that repo-name prefix baked in at build time.
// Set it via an env var so local dev (npm run dev) still runs at "/" —
// only the production build needs the subpath.
//   GITHUB_PAGES_REPO=setout npm run build
const repoName = process.env.GITHUB_PAGES_REPO;

export default defineConfig({
  base: repoName ? `/${repoName}/` : "/",
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        catalog: path.resolve(import.meta.dirname, "catalog.html"),
      },
    },
  },
});
