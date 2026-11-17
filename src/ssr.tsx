import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import type { TesseraPageId } from "./tessera/Layout";
import { pages } from "./tessera/pages";
import type { SwitchboardPageId } from "./switchboard/Layout";
import { pages as switchboardPages } from "./switchboard/pages";

export function render(id: TesseraPageId): string {
  const Page = pages[id];
  return renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}

export function renderSwitchboard(id: SwitchboardPageId): string {
  const Page = switchboardPages[id];
  return renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
