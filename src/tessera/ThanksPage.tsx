import { useEffect, useState } from "react";
import { PageIntro, TesseraLayout, email as supportEmail, paths } from "./Layout";

type State =
  | { kind: "loading" }
  | { kind: "ready"; license: string; email: string; activationUrl: string }
  | { kind: "pending" }
  | { kind: "revisit" }
  | { kind: "error" };

type CopyState = "idle" | "copied" | "failed";

interface LicenseResponse {
  license: string;
  email: string;
  activationUrl: string;
}

const button = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition";

// The Checkout Session id in the address works as a link to the key, so it is read once and then removed from the
// address bar (history, bookmarks and screenshots never hold it). It lives only in this variable: a reload starts
// from nothing and sends the buyer to "find my license". Read at module level so React's double effects in
// development don't see the stripped address the second time.
let takenSessionId: string | null | undefined;
function takeSessionId(): string | null {
  if (takenSessionId === undefined) {
    takenSessionId = new URLSearchParams(window.location.search).get("session_id");
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }
  return takenSessionId;
}

export function ThanksPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [copy, setCopy] = useState<CopyState>("idle");

  useEffect(() => {
    const sessionId = takeSessionId();
    if (!sessionId) {
      setState({ kind: "revisit" });
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/tessera/license?session_id=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (res.status === 409) setState({ kind: "pending" });
        else if (!res.ok) setState({ kind: "error" });
        else {
          const body = (await res.json()) as LicenseResponse;
          setState({ kind: "ready", license: body.license, email: body.email, activationUrl: body.activationUrl });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  async function copyLicense(license: string) {
    try {
      await navigator.clipboard.writeText(license);
      setCopy("copied");
      window.setTimeout(() => setCopy("idle"), 2500);
    } catch {
      setCopy("failed");
    }
  }

  return (
    <TesseraLayout current="thanks">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Thanks for buying Tessera Pro" subtitle="Your license" />

        <section aria-labelledby="license-title" aria-live="polite" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 id="license-title" className="text-2xl font-medium md:text-3xl">
            {state.kind === "error" ? "Your license is on its way" : state.kind === "pending" ? "Your payment is still processing" : state.kind === "revisit" ? "Your license was emailed to you" : "Your license key"}
          </h2>

          {state.kind === "loading" && <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">Getting your license…</p>}

          {state.kind === "pending" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              Some payment methods take a little while to clear. I'll email your license as soon as the payment goes through. You can also check back on the <a href={paths.license} className="font-medium text-tessera-accent underline underline-offset-4">find my license</a> page.
            </p>
          )}

          {state.kind === "revisit" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              For your security this page shows your key only once, right after you pay, and not again after a reload. Your license is in the email I sent you. If it hasn't arrived, use the <a href={paths.license} className="font-medium text-tessera-accent underline underline-offset-4">find my license</a> page, or email <a href={`mailto:${supportEmail}`} className="font-medium text-tessera-accent underline underline-offset-4">{supportEmail}</a>.
            </p>
          )}

          {state.kind === "error" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              Your license has been emailed to you. If it hasn't arrived, you can get it again on the <a href={paths.license} className="font-medium text-tessera-accent underline underline-offset-4">find my license</a> page, or email <a href={`mailto:${supportEmail}`} className="font-medium text-tessera-accent underline underline-offset-4">{supportEmail}</a>.
            </p>
          )}

          {state.kind === "ready" && (
            <>
              <p className="mt-3 text-tessera-panel-muted">Licensed to {state.email}</p>
              <p className="mt-4 select-all break-all rounded-xl bg-tessera-panel-deep p-4 font-mono text-sm leading-relaxed">{state.license}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => copyLicense(state.license)} className={`${button} bg-foreground text-background hover:opacity-90`}>
                  {copy === "copied" ? "Copied" : "Copy license"}
                </button>
                <a href={state.activationUrl} className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>Open in Tessera <span aria-hidden="true">→</span></a>
                <a href="/tessera/download" className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>Download Tessera <span aria-hidden="true">↓</span></a>
              </div>
              {copy === "failed" && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. Select the key above and copy it.</p>}
              <p className="mt-6 text-tessera-panel-muted">I've also emailed a copy to the same address, so you'll always have it. For your security, this page won't show the key again after you reload: copy it now, or use <a href={paths.license} className="font-medium text-tessera-accent underline underline-offset-4">find my license</a> later.</p>
            </>
          )}
        </section>

        <section aria-labelledby="steps-title" className="mt-12">
          <h2 id="steps-title" className="text-2xl font-medium md:text-3xl">How to activate</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-lg leading-relaxed text-muted-foreground">
            <li>Download and open Tessera, if you haven't already.</li>
            <li>In Tessera, go to <strong className="font-medium text-foreground">Settings › Purchases › Enter License…</strong>, or press Open in Tessera above.</li>
            <li>Paste your key and press Activate.</li>
          </ol>
          <p className="mt-6 text-muted-foreground">Lost the key later? <a href={paths.license} className="text-foreground underline underline-offset-4 hover:text-primary">Find my license</a> any time. Please don't share it: it's tied to your purchase.</p>
        </section>
      </div>
    </TesseraLayout>
  );
}
