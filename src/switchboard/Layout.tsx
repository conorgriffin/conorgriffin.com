import type { ReactNode } from "react";
import { SiteHeader, useReveal } from "@/components/site";

// Audio Switchboard's pages share Tessera's look (tokens, PageIntro, Part) and have their own header, footer and links.
export { PageIntro, Part } from "../tessera/Layout";

export type SwitchboardPageId = "home" | "privacy" | "support" | "thanks" | "activate" | "license" | "terms";

export const paths: Record<SwitchboardPageId, string> = {
  home: "/switchboard",
  privacy: "/switchboard/privacy",
  support: "/switchboard/support",
  thanks: "/switchboard/thanks",
  activate: "/switchboard/activate",
  license: "/switchboard/license",
  terms: "/switchboard/terms",
};

export const buyPath = "/switchboard/buy";
export const downloadPath = "/switchboard/download";

export const email = "support@conorgriffin.com";

/** Audio Switchboard's Mac App Store listing (from the app's own site, getswitchboard.app). */
export const APP_STORE_URL = "https://apps.apple.com/us/app/audio-switchboard/id6761267361";

/** The app icon. TODO: public/switchboard/icon.png is the 176px icon from the landing page repo; replace it with a 256px export. */
export const ICON_SRC = "/switchboard/icon.png";

export function SwitchboardIcon({ size = 28 }: { size?: number }) {
  return <img src={ICON_SRC} width={size} height={size} alt="" className="rounded-[22%]" />;
}

const navItems: [SwitchboardPageId, string][] = [["home", "Audio Switchboard"], ["support", "Support"]];

export function SwitchboardLayout({ current, children }: { current: SwitchboardPageId; children: ReactNode }) {
  useReveal();
  return (
    <div className="min-h-screen">
      <SiteHeader
        nav={
          <ul className="flex items-center gap-3 text-sm text-muted-foreground sm:gap-6">
            {navItems.map(([id, label]) => (
              <li key={id}>
                <a href={paths[id]} aria-current={id === current ? "page" : undefined}
                  className={`transition hover:text-foreground ${id === current ? "text-foreground" : ""}`}>{label}</a>
              </li>
            ))}
          </ul>
        }
      />
      <main id="main" className="mx-auto max-w-5xl px-6">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <SwitchboardIcon />
            <p className="text-sm text-muted-foreground">Audio Switchboard for Mac · by <a href="/" className="underline-offset-4 hover:text-foreground hover:underline">Conor Griffin</a></p>
          </div>
          <ul className="flex gap-6 text-sm">
            <li><a href={paths.privacy} className="underline-offset-4 hover:text-primary hover:underline">Privacy policy</a></li>
            <li><a href={paths.terms} className="underline-offset-4 hover:text-primary hover:underline">Terms of sale</a></li>
            <li><a href={paths.support} className="underline-offset-4 hover:text-primary hover:underline">Support</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
