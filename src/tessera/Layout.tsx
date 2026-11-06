import type { ReactNode } from "react";
import { SiteHeader, useReveal } from "@/components/site";
import { links } from "@/content/site";
import { TesseraIcon } from "./TesseraIcon";

export type TesseraPageId = "home" | "privacy" | "support";

export const paths: Record<TesseraPageId, string> = {
  home: "/tessera",
  privacy: "/tessera/privacy",
  support: "/tessera/support",
};

export const email = links.email.replace(/^mailto:/, "");

const navItems: [TesseraPageId, string][] = [["home", "Tessera"], ["privacy", "Privacy"], ["support", "Support"]];

export function TesseraLayout({ current, children }: { current: TesseraPageId; children: ReactNode }) {
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
            <TesseraIcon size={28} />
            <p className="text-sm text-muted-foreground">Tessera for Mac · by <a href="/" className="underline-offset-4 hover:text-foreground hover:underline">Conor Griffin</a></p>
          </div>
          <ul className="flex gap-6 text-sm">
            <li><a href={paths.privacy} className="underline-offset-4 hover:text-primary hover:underline">Privacy policy</a></li>
            <li><a href={paths.support} className="underline-offset-4 hover:text-primary hover:underline">Support</a></li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

export function PageIntro({ title, subtitle, children }: { title: string; subtitle: string; children?: ReactNode }) {
  return (
    <div className="pt-16 md:pt-24">
      <p className="eyebrow">{subtitle}</p>
      <h1 className="mt-4 text-5xl font-medium md:text-6xl">{title}</h1>
      {children}
      <div className="tessera-rule mt-8 w-24" />
    </div>
  );
}
