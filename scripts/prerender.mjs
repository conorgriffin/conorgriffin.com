// Renders the Tessera and Audio Switchboard pages to static HTML after `vite build`, so the privacy
// policy and support page work without JavaScript and are easy to crawl.
import { readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { render, renderSwitchboard } = await import(pathToFileURL(resolve("dist-ssr/ssr.js")).href);

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

const switchboardPages = {
  home: "dist/switchboard/index.html",
  privacy: "dist/switchboard/privacy/index.html",
  support: "dist/switchboard/support/index.html",
  thanks: "dist/switchboard/thanks/index.html",
  activate: "dist/switchboard/activate/index.html",
  license: "dist/switchboard/license/index.html",
  terms: "dist/switchboard/terms/index.html",
};

async function prerender(set, renderPage) {
  for (const [id, file] of Object.entries(set)) {
    const html = await readFile(file, "utf8");
    const marker = '<div id="root"></div>';
    if (!html.includes(marker)) throw new Error(`${file}: no empty #root to fill`);
    await writeFile(file, html.replace(marker, `<div id="root">${renderPage(id)}</div>`));
    console.log(`prerendered ${file}`);
  }
}

await prerender(pages, render);
await prerender(switchboardPages, renderSwitchboard);

await rm("dist-ssr", { recursive: true, force: true });
