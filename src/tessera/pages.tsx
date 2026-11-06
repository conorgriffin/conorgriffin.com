import type { ComponentType } from "react";
import type { TesseraPageId } from "./Layout";
import { TesseraPage } from "./TesseraPage";
import { PrivacyPage } from "./PrivacyPage";
import { SupportPage } from "./SupportPage";

export const pages: Record<TesseraPageId, ComponentType> = {
  home: TesseraPage,
  privacy: PrivacyPage,
  support: SupportPage,
};
