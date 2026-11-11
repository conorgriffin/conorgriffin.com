// Renders the Tessera pages to static HTML after `vite build`, so the privacy
// policy and support page work without JavaScript and are easy to crawl.
import { readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { render } = await import(pathToFileURL(resolve("dist-ssr/ssr.js")).href);

const pages = {
  home: "dist/tessera/index.html",
  privacy: "dist/tessera/privacy/index.html",
  support: "dist/tessera/support/index.html",
  thanks: "dist/tessera/thanks/index.html",
  activate: "dist/tessera/activate/index.html",
  license: "dist/tessera/license/index.html",
  terms: "dist/tessera/terms/index.html",
  admin: "dist/tessera/admin/index.html",
  guide: "dist/tessera/guide/index.html",
  learn: "dist/tessera/learn/index.html",
};

for (const [id, file] of Object.entries(pages)) {
  const html = await readFile(file, "utf8");
  const marker = '<div id="root"></div>';
  if (!html.includes(marker)) throw new Error(`${file}: no empty #root to fill`);
  await writeFile(file, html.replace(marker, `<div id="root">${render(id)}</div>`));
  console.log(`prerendered ${file}`);
}

await rm("dist-ssr", { recursive: true, force: true });
