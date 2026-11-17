import type { ComponentType } from "react";
import type { SwitchboardPageId } from "./Layout";
import { SwitchboardPage } from "./SwitchboardPage";
import { PrivacyPage } from "./PrivacyPage";
import { SupportPage } from "./SupportPage";
import { TermsPage } from "./TermsPage";
import { ActivatePage, LicensePage, ThanksPage } from "./LicensePages";

export const pages: Record<SwitchboardPageId, ComponentType> = {
  home: SwitchboardPage,
  privacy: PrivacyPage,
  support: SupportPage,
  thanks: ThanksPage,
  activate: ActivatePage,
  license: LicensePage,
  terms: TermsPage,
};
