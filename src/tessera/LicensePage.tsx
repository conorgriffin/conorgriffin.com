import { useState } from "react";
import type { FormEvent } from "react";
import { PageIntro, TesseraLayout, email as supportEmail } from "./Layout";

type Status = "idle" | "sending" | "done" | "error";

export function LicensePage() {
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const res = await fetch("/api/tessera/resend", {
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
    <TesseraLayout current="license">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Find my license" subtitle="Tessera for Mac">
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">Bought Tessera Pro on this website and lost your key? Enter the email you bought with and I'll send it again.</p>
        </PageIntro>

        <form onSubmit={submit} className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <label htmlFor="license-email" className="text-lg font-medium">Email address</label>
          <input id="license-email" name="email" type="email" required autoComplete="email" inputMode="email" value={address}
            onChange={(e) => setAddress(e.target.value)} placeholder="you@example.com"
            className="mt-3 w-full rounded-xl border border-tessera-panel-line bg-tessera-panel-deep px-4 py-3 text-lg text-tessera-panel-ink placeholder:text-tessera-panel-muted focus:outline-2 focus:outline-offset-2 focus:outline-tessera-accent" />
          <button type="submit" disabled={status === "sending"}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90 disabled:opacity-60">
            {status === "sending" ? "Sending…" : "Send my license"} <span aria-hidden="true">→</span>
          </button>
          <div aria-live="polite" className="mt-5 text-tessera-panel-muted">
            {status === "done" && (
              <p>If there's a purchase for that address, I've emailed your license. It usually arrives within a few minutes, so check your spam folder too.</p>
            )}
            {status === "error" && (
              <p className="text-tessera-warn">Something went wrong. Please try again, or email <a href={`mailto:${supportEmail}`} className="underline underline-offset-4">{supportEmail}</a>.</p>
            )}
          </div>
        </form>

        <p className="mt-8 leading-relaxed text-muted-foreground">
          Bought on the Mac App Store instead? Open Tessera › Tessera Pro… and choose Restore Purchase. Still stuck? <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Tessera license")}`} className="text-foreground underline underline-offset-4 hover:text-primary">Email support</a>.
        </p>
      </div>
    </TesseraLayout>
  );
}
