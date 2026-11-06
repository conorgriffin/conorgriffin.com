import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "../styles.css";
import type { TesseraPageId } from "./Layout";
import { pages } from "./pages";

const root = document.getElementById("root")!;
const Page = pages[(document.body.dataset.page ?? "home") as TesseraPageId];
const app = (
  <StrictMode>
    <Page />
  </StrictMode>
);

// Production HTML is prerendered (scripts/prerender.mjs), so hydrate it; the dev server serves an empty root.
if (root.hasChildNodes()) hydrateRoot(root, app);
else createRoot(root).render(app);
