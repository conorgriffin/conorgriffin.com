import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react(), tailwindcss()],
  build: isSsrBuild
    ? {}
    : {
        rollupOptions: {
          // One HTML page per URL. Vercel serves dist/tessera/privacy/index.html at /tessera/privacy.
          input: {
            main: "index.html",
            tessera: "tessera/index.html",
            "tessera-privacy": "tessera/privacy/index.html",
            "tessera-support": "tessera/support/index.html",
          },
        },
      },
}));
