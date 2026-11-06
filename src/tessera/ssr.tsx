import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import type { TesseraPageId } from "./Layout";
import { pages } from "./pages";

export function render(id: TesseraPageId): string {
  const Page = pages[id];
  return renderToString(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
