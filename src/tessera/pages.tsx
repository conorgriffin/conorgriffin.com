import type { ComponentType } from "react";
import type { TesseraPageId } from "./Layout";
import { TesseraPage } from "./TesseraPage";
import { PrivacyPage } from "./PrivacyPage";
import { SupportPage } from "./SupportPage";
import { ThanksPage } from "./ThanksPage";
import { LicensePage } from "./LicensePage";
import { TermsPage } from "./TermsPage";
import { AdminPage } from "./AdminPage";

export const pages: Record<TesseraPageId, ComponentType> = {
  home: TesseraPage,
  privacy: PrivacyPage,
  support: SupportPage,
  thanks: ThanksPage,
  license: LicensePage,
  terms: TermsPage,
  admin: AdminPage,
};
