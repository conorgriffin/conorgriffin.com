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
            "tessera-thanks": "tessera/thanks/index.html",
            "tessera-activate": "tessera/activate/index.html",
            "tessera-license": "tessera/license/index.html",
            "tessera-terms": "tessera/terms/index.html",
            "tessera-admin": "tessera/admin/index.html",
            "tessera-guide": "tessera/guide/index.html",
            "tessera-learn": "tessera/learn/index.html",
            switchboard: "switchboard/index.html",
            "switchboard-privacy": "switchboard/privacy/index.html",
            "switchboard-support": "switchboard/support/index.html",
            "switchboard-thanks": "switchboard/thanks/index.html",
            "switchboard-activate": "switchboard/activate/index.html",
            "switchboard-license": "switchboard/license/index.html",
            "switchboard-terms": "switchboard/terms/index.html",
          },
        },
      },
}));
