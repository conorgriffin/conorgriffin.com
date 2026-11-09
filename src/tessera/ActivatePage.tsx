import { useEffect, useState } from "react";
import { PageIntro, TesseraLayout, paths } from "./Layout";

type CopyState = "idle" | "copied" | "failed";

const button = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition";

// The key arrives in the address fragment (#key=...), which never reaches a server. It is read once and removed from
// the address bar straight away, and lives only in this variable. Read at module level so React's double effects in
// development don't see the stripped address the second time.
let takenKey: string | null | undefined;
function takeKey(): string | null {
  if (takenKey === undefined) {
    const raw = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key")?.trim() ?? "";
    takenKey = raw.startsWith("TSR1-") ? raw : null;
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return takenKey;
}

let opened = false;

export function ActivatePage() {
  const [license, setLicense] = useState<string | null | undefined>(undefined);
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    const key = takeKey();
    setLicense(key);
    if (key && !opened) {
      opened = true;
      window.location.href = `tessera-direct://activate?key=${encodeURIComponent(key)}`;
    }
  }, []);

  async function copyLicense(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopy("copied");
      window.setTimeout(() => setCopy("idle"), 2500);
    } catch {
      setCopy("failed");
    }
  }

  return (
    <TesseraLayout current="activate">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Activate Tessera Pro" subtitle="Your license" />

        <section aria-labelledby="activate-title" aria-live="polite" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          {license === undefined && <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">Opening Tessera…</h2>}

          {license === null && (
            <>
              <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">No license key in this link</h2>
              <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
                This link needs the key from your license email. If it got cut off, use the <a href={paths.license} className="font-medium text-tessera-accent underline underline-offset-4">find my license</a> page and I'll send it again.
              </p>
            </>
          )}

          {license && (
            <>
              <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">Opening Tessera…</h2>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href={`tessera-direct://activate?key=${encodeURIComponent(license)}`} className={`${button} bg-foreground text-background hover:opacity-90`}>Open in Tessera <span aria-hidden="true">→</span></a>
              </div>
              <p className="mt-6 select-all break-all rounded-xl bg-tessera-panel-deep p-4 font-mono text-sm leading-relaxed">{license}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => copyLicense(license)} className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>
                  {copy === "copied" ? "Copied" : "Copy license"}
                </button>
              </div>
              {copy === "failed" && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. Select the key above and copy it.</p>}
              <p className="mt-6 text-tessera-panel-muted">
                Nothing happened? Make sure Tessera is <a href="/tessera/download" className="font-medium text-tessera-accent underline underline-offset-4">installed</a>, or open Tessera, go to <strong className="font-medium text-tessera-panel-ink">Settings › Purchases › Enter License…</strong> and paste the key.
              </p>
            </>
          )}
        </section>
      </div>
    </TesseraLayout>
  );
}
