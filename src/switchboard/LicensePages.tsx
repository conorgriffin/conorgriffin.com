// Thanks, Activate and Find-my-license for Audio Switchboard. They behave exactly like Tessera's (see
// src/tessera/ThanksPage.tsx and friends): the key is shown once, read from the address and removed from it.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { PageIntro, SwitchboardLayout, downloadPath, email as supportEmail, paths } from "./Layout";

type CopyState = "idle" | "copied" | "failed";

const button = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition";
const panel = "mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8";
const inline = "font-medium text-tessera-accent underline underline-offset-4";
const SCHEME = "switchboard-direct";

// ------------------------------------------------------------------ thanks

type ThanksState =
  | { kind: "loading" }
  | { kind: "ready"; license: string; email: string; activationUrl: string }
  | { kind: "pending" }
  | { kind: "revisit" }
  | { kind: "error" };

// The Checkout Session id in the address works as a link to the key, so it is read once and then removed from the
// address bar (history, bookmarks and screenshots never hold it). It lives only in this variable: a reload starts
// from nothing and sends the buyer to "find my license".
let takenSessionId: string | null | undefined;
function takeSessionId(): string | null {
  if (takenSessionId === undefined) {
    takenSessionId = new URLSearchParams(window.location.search).get("session_id");
    if (window.location.search || window.location.hash) window.history.replaceState(null, "", window.location.pathname);
  }
  return takenSessionId;
}

function useCopy() {
  const [copy, setCopy] = useState<CopyState>("idle");
  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
      window.setTimeout(() => setCopy("idle"), 2500);
    } catch {
      setCopy("failed");
    }
  }
  return { copy, copyText };
}

export function ThanksPage() {
  const [state, setState] = useState<ThanksState>({ kind: "loading" });
  const { copy, copyText } = useCopy();

  useEffect(() => {
    const sessionId = takeSessionId();
    if (!sessionId) {
      setState({ kind: "revisit" });
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/switchboard/license?session_id=${encodeURIComponent(sessionId)}`, { signal: controller.signal });
        if (res.status === 409) setState({ kind: "pending" });
        else if (!res.ok) setState({ kind: "error" });
        else {
          const body = (await res.json()) as { license: string; email: string; activationUrl: string };
          setState({ kind: "ready", license: body.license, email: body.email, activationUrl: body.activationUrl });
        }
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  const findLink = <a href={paths.license} className={inline}>find my license</a>;
  const mail = <a href={`mailto:${supportEmail}`} className={inline}>{supportEmail}</a>;

  return (
    <SwitchboardLayout current="thanks">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Thanks for buying Audio Switchboard" subtitle="Your license" />

        <section aria-labelledby="license-title" aria-live="polite" className={panel}>
          <h2 id="license-title" className="text-2xl font-medium md:text-3xl">
            {state.kind === "error" ? "Your license is on its way" : state.kind === "pending" ? "Your payment is still processing" : state.kind === "revisit" ? "Your license was emailed to you" : "Your license key"}
          </h2>

          {state.kind === "loading" && <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">Getting your license…</p>}
          {state.kind === "pending" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              Some payment methods take a little while to clear. I'll email your license as soon as the payment goes through. You can also check back on the {findLink} page.
            </p>
          )}
          {state.kind === "revisit" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              For your security this page shows your key only once, right after you pay, and not again after a reload. Your license is in the email I sent you. If it hasn't arrived, use the {findLink} page, or email {mail}.
            </p>
          )}
          {state.kind === "error" && (
            <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
              Your license has been emailed to you. If it hasn't arrived, you can get it again on the {findLink} page, or email {mail}.
            </p>
          )}
          {state.kind === "ready" && (
            <>
              <p className="mt-3 text-tessera-panel-muted">Licensed to {state.email}</p>
              <p className="mt-4 select-all break-all rounded-xl bg-tessera-panel-deep p-4 font-mono text-sm leading-relaxed">{state.license}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => copyText(state.license)} className={`${button} bg-foreground text-background hover:opacity-90`}>
                  {copy === "copied" ? "Copied" : "Copy license"}
                </button>
                <a href={state.activationUrl} className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>Open in Audio Switchboard <span aria-hidden="true">→</span></a>
                <a href={downloadPath} className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>Download <span aria-hidden="true">↓</span></a>
              </div>
              {copy === "failed" && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. Select the key above and copy it.</p>}
              <p className="mt-6 text-tessera-panel-muted">I've also emailed a copy to the same address, so you'll always have it. For your security, this page won't show the key again after you reload: copy it now, or use {findLink} later.</p>
            </>
          )}
        </section>

        <section aria-labelledby="steps-title" className="mt-12">
          <h2 id="steps-title" className="text-2xl font-medium md:text-3xl">How to activate</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-6 text-lg leading-relaxed text-muted-foreground">
            <li>Download and open Audio Switchboard, if you haven't already.</li>
            <li>In Audio Switchboard, open <strong className="font-medium text-foreground">Settings › Purchase</strong>, or press Open in Audio Switchboard above.</li>
            <li>Paste your key and activate.</li>
          </ol>
          <p className="mt-6 text-muted-foreground">Lost the key later? <a href={paths.license} className="text-foreground underline underline-offset-4 hover:text-primary">Find my license</a> any time. Please don't share it: it's tied to your purchase.</p>
        </section>
      </div>
    </SwitchboardLayout>
  );
}

// ------------------------------------------------------------------ activate

// The key arrives in the address fragment (#key=...), which never reaches a server. It is read once and removed from
// the address bar straight away, and lives only in this variable.
let takenKey: string | null | undefined;
function takeKey(): string | null {
  if (takenKey === undefined) {
    const raw = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("key")?.trim() ?? "";
    takenKey = raw.startsWith("SWB1-") ? raw : null;
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return takenKey;
}

let opened = false;

export function ActivatePage() {
  const [license, setLicense] = useState<string | null | undefined>(undefined);
  const { copy, copyText } = useCopy();

  useEffect(() => {
    const key = takeKey();
    setLicense(key);
    if (key && !opened) {
      opened = true;
      window.location.href = `${SCHEME}://activate?key=${encodeURIComponent(key)}`;
    }
  }, []);

  return (
    <SwitchboardLayout current="activate">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Activate Audio Switchboard" subtitle="Your license" />

        <section aria-labelledby="activate-title" aria-live="polite" className={panel}>
          {license === undefined && <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">Opening Audio Switchboard…</h2>}

          {license === null && (
            <>
              <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">No license key in this link</h2>
              <p className="mt-3 text-lg leading-relaxed text-tessera-panel-muted">
                This link needs the key from your license email. If it got cut off, use the <a href={paths.license} className={inline}>find my license</a> page and I'll send it again.
              </p>
            </>
          )}

          {license && (
            <>
              <h2 id="activate-title" className="text-2xl font-medium md:text-3xl">Opening Audio Switchboard…</h2>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href={`${SCHEME}://activate?key=${encodeURIComponent(license)}`} className={`${button} bg-foreground text-background hover:opacity-90`}>Open in Audio Switchboard <span aria-hidden="true">→</span></a>
              </div>
              <p className="mt-6 select-all break-all rounded-xl bg-tessera-panel-deep p-4 font-mono text-sm leading-relaxed">{license}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => copyText(license)} className={`${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`}>
                  {copy === "copied" ? "Copied" : "Copy license"}
                </button>
              </div>
              {copy === "failed" && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. Select the key above and copy it.</p>}
              <p className="mt-6 text-tessera-panel-muted">
                Nothing happened? Make sure Audio Switchboard is <a href={downloadPath} className={inline}>installed</a>, or open it, go to <strong className="font-medium text-tessera-panel-ink">Settings › Purchase</strong> and paste the key.
              </p>
            </>
          )}
        </section>
      </div>
    </SwitchboardLayout>
  );
}

// ------------------------------------------------------------------ find my license

export function LicensePage() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/switchboard/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: address }),
      });
      setStatus(res.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  return (
    <SwitchboardLayout current="license">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Find my license" subtitle="Audio Switchboard for Mac">
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">Bought Audio Switchboard on this website and lost your key? Enter the email you bought with and I'll send it again.</p>
        </PageIntro>

        <form onSubmit={submit} className={panel}>
          <label htmlFor="license-email" className="text-lg font-medium">Email address</label>
          <input id="license-email" name="email" type="email" required autoComplete="email" inputMode="email" value={address}
            onChange={(e) => setAddress(e.target.value)} placeholder="you@example.com"
            className="mt-3 w-full rounded-xl border border-tessera-panel-line bg-tessera-panel-deep px-4 py-3 text-lg text-tessera-panel-ink placeholder:text-tessera-panel-muted focus:outline-2 focus:outline-offset-2 focus:outline-tessera-accent" />
          <button type="submit" disabled={status === "sending"}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            {status === "sending" ? "Sending…" : "Send my license"} <span aria-hidden="true">→</span>
          </button>
          <div aria-live="polite" className="mt-5 text-tessera-panel-muted">
            {status === "done" && <p>If there's a purchase for that address, I've emailed your license. It usually arrives within a few minutes, so check your spam folder too.</p>}
            {status === "error" && <p className="text-tessera-warn">Something went wrong. Please try again, or email <a href={`mailto:${supportEmail}`} className="underline underline-offset-4">{supportEmail}</a>.</p>}
          </div>
        </form>

        <p className="mt-8 leading-relaxed text-muted-foreground">
          This page is for licenses bought on this website. A Mac App Store purchase is tied to your Apple ID and doesn't need a key. Still stuck? <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Audio Switchboard license")}`} className="text-foreground underline underline-offset-4 hover:text-primary">Email support</a>.
        </p>
      </div>
    </SwitchboardLayout>
  );
}
