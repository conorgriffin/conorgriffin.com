import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { PageIntro, TesseraLayout } from "./Layout";

// Private admin page for Tessera licenses. It holds no secrets: every call goes to /api/tessera/admin*, which
// checks the signed session cookie set by "Sign in with Google". Keys are only ever sent in request bodies.

interface License {
  lid: string;
  email: string;
  issuedAt: number;
  revokedAt: number | null;
  revokeReason: string | null;
  /** The payment itself was refunded or disputed, whatever else revoked the license. */
  paymentStatus: "refund" | "dispute" | null;
  paymentRevokedAt: number | null;
  replacedBy: string | null;
  reissuedFrom: string | null;
  emailedAt: number | null;
}

type Session =
  | { kind: "loading" }
  | { kind: "unconfigured" }
  | { kind: "error" }
  | { kind: "out" }
  | { kind: "in"; email: string };

type Lookup =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; licenses: License[] }
  | { kind: "error"; message: string };

type Pending =
  | { action: "revoke"; license: License }
  | { action: "unrevoke"; license: License }
  | { action: "reissue"; license: License };

interface Reissued {
  newLid: string;
  oldLid: string;
  emailed: boolean;
  license: string;
  email: string;
}

const LOGIN_ERRORS: Record<string, string> = {
  denied: "Google sign-in was cancelled. You can try again whenever you like.",
  state: "That sign-in attempt expired or didn't match. Please start again.",
  token: "Google sign-in couldn't be completed. Please try again.",
  not_allowed: "That Google account isn't allowed to use this page.",
};

const REVOKE_REASONS: Record<string, string> = {
  leaked: "leaked",
  manual: "manual",
  refund: "refunded",
  dispute: "disputed",
  reissued: "reissued",
};

const PAYMENT_STATUS: Record<string, string> = {
  refund: "Refunded",
  dispute: "Disputed",
};

const button = "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition disabled:opacity-60";
const primaryButton = `${button} bg-foreground text-background hover:opacity-90`;
const quietButton = `${button} border border-tessera-panel-line hover:bg-tessera-panel-deep`;
const panel = "rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8";

const formatDateTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const shortId = (lid: string) => lid.slice(0, 8);
const formatDate = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** POSTs an admin action. The key (when searching by key) travels in the body, never in a URL. */
async function adminRequest(body: Record<string, string>): Promise<{ status: number; data: any }> {
  const res = await fetch("/api/tessera/admin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const copy = useCallback(async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(tag);
      window.setTimeout(() => setCopied((c) => (c === tag ? null : c)), 2000);
    } catch {
      setFailed(true);
    }
  }, []);
  return { copied, failed, copy };
}

export function AdminPage() {
  const [session, setSession] = useState<Session>({ kind: "loading" });
  const [loginError, setLoginError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("error");
    if (code !== null) {
      setLoginError(LOGIN_ERRORS[code] ?? LOGIN_ERRORS.token);
      window.history.replaceState(null, "", window.location.pathname);
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/tessera/admin-session", { signal: controller.signal });
        if (res.status === 404) setSession({ kind: "unconfigured" });
        else if (!res.ok) setSession({ kind: "error" });
        else {
          const body = (await res.json()) as { signedIn: boolean; email?: string };
          setSession(body.signedIn && body.email ? { kind: "in", email: body.email } : { kind: "out" });
        }
      } catch {
        if (!controller.signal.aborted) setSession({ kind: "error" });
      }
    })();
    return () => controller.abort();
  }, []);

  async function signOut() {
    setSignOutError(null);
    try {
      const res = await fetch("/api/tessera/admin-logout", { method: "POST" });
      // The server ends the session itself; if it couldn't, stay signed in so this can be retried.
      if (!res.ok) {
        setSignOutError("Couldn't sign out. Please try again.");
        return;
      }
    } catch {
      setSignOutError("Couldn't reach the server to sign out. Please try again.");
      return;
    }
    setSession({ kind: "out" });
  }

  return (
    <TesseraLayout current="admin">
      <div className="mx-auto max-w-3xl pb-24">
        <PageIntro title="License admin" subtitle="Tessera for Mac" />

        {session.kind === "loading" && <p className="mt-10 text-lg text-muted-foreground" aria-live="polite">Checking sign-in…</p>}

        {session.kind === "unconfigured" && (
          <section className={`mt-10 ${panel}`}>
            <h2 className="text-2xl font-medium">Admin sign-in isn't configured</h2>
            <p className="mt-3 leading-relaxed text-tessera-panel-muted">Set the Google sign-in variables on the server to turn this page on.</p>
          </section>
        )}

        {session.kind === "error" && (
          <section className={`mt-10 ${panel}`} aria-live="polite">
            <h2 className="text-2xl font-medium">Couldn't check your sign-in</h2>
            <p className="mt-3 leading-relaxed text-tessera-panel-muted">Something went wrong reaching the server. Reload the page to try again.</p>
          </section>
        )}

        {session.kind === "out" && (
          <section className={`mt-10 ${panel}`}>
            <h2 className="text-2xl font-medium">Sign in</h2>
            <p className="mt-3 leading-relaxed text-tessera-panel-muted">This page is for managing Tessera licenses. Sign in with the Google account that has access.</p>
            {loginError && <p role="alert" className="mt-4 text-tessera-warn">{loginError}</p>}
            <a href="/api/tessera/admin-login" className={`mt-6 ${primaryButton}`}>Sign in with Google <span aria-hidden="true">→</span></a>
          </section>
        )}

        {session.kind === "in" && (
          <>
            <p className="mt-6 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span>Signed in as <span className="text-foreground">{session.email}</span></span>
              <span aria-hidden="true">·</span>
              <button type="button" onClick={signOut} className="underline underline-offset-4 hover:text-foreground">Sign out</button>
            </p>
            {signOutError && <p role="alert" className="mt-2 text-sm text-tessera-warn">{signOutError}</p>}
            <Clicks onSignedOut={() => setSession({ kind: "out" })} />
            <Licenses onSignedOut={() => setSession({ kind: "out" })} />
          </>
        )}
      </div>
    </TesseraLayout>
  );
}

interface DayClicks { date: string; download: number; buy: number }

/** Download and Buy Pro clicks on the site (people only; brew installs and in-app updates don't go through it). */
function Clicks({ onSignedOut }: { onSignedOut: () => void }) {
  const [days, setDays] = useState<DayClicks[] | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  useEffect(() => {
    let live = true;
    adminRequest({ action: "stats" })
      .then(({ status, data }) => {
        if (!live) return;
        if (status === 401) signedOut.current();
        else if (status === 200 && Array.isArray(data?.days)) {
          setDays(data.days as DayClicks[]);
          if (typeof data.stripeProductId === "string" && /^prod_[A-Za-z0-9]+$/.test(data.stripeProductId)) setProductId(data.stripeProductId);
        }
        else setFailed(true);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, []);

  const sum = (n: number, key: "download" | "buy") => (days ?? []).slice(0, n).reduce((t, d) => t + d[key], 0);
  const recent = (days ?? []).slice(0, 14);
  const max = Math.max(1, ...recent.map((d) => d.download));
  const label = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <section aria-labelledby="clicks-title" className={`mt-6 ${panel}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="clicks-title" className="text-lg font-medium">Site clicks</h2>
        <a href={productId ? `https://dashboard.stripe.com/products/${productId}` : "https://dashboard.stripe.com/products"}
          target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4 hover:text-tessera-accent">
          Tessera Pro in Stripe<span className="sr-only"> (opens in a new tab)</span> <span aria-hidden="true">↗</span>
        </a>
      </div>
      <p className="mt-1 text-sm text-tessera-panel-muted">Download and Buy Pro clicks on this site, by UTC day. Brew installs and in-app updates aren't included.</p>
      {failed && <p role="alert" className="mt-4 text-tessera-warn">Couldn't load the counts. Reload to try again.</p>}
      {!failed && !days && <p className="mt-4 text-tessera-panel-muted" aria-live="polite">Loading…</p>}
      {days && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {([["Today", 1], ["Last 7 days", 7], ["Last 30 days", 30]] as const).map(([title, n]) => (
              <div key={title} className="rounded-xl bg-tessera-panel-deep p-4">
                <dt className="text-sm text-tessera-panel-muted">{title}</dt>
                <dd className="mt-1 text-2xl font-medium tabular-nums">{sum(n, "download")} <span className="text-sm font-normal text-tessera-panel-muted">downloads</span></dd>
                <dd className="text-sm tabular-nums text-tessera-panel-muted">{sum(n, "buy")} Buy Pro</dd>
              </div>
            ))}
          </dl>
          <table className="mt-6 w-full text-sm">
            <caption className="sr-only">Clicks per day, last 14 days</caption>
            <thead className="text-left text-tessera-panel-muted">
              <tr><th scope="col" className="pb-2 font-normal">Day</th><th scope="col" className="pb-2 font-normal">Downloads</th><th scope="col" className="pb-2 text-right font-normal">Buy Pro</th></tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.date}>
                  <th scope="row" className="w-20 py-1 pr-3 text-left font-normal text-tessera-panel-muted">{label(d.date)}</th>
                  <td className="py-1">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-2 rounded-full bg-tessera-accent" style={{ width: `${(d.download / max) * 70}%`, minWidth: d.download ? "4px" : 0 }} />
                      <span className="tabular-nums">{d.download}</span>
                    </span>
                  </td>
                  <td className="py-1 text-right tabular-nums">{d.buy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function Licenses({ onSignedOut }: { onSignedOut: () => void }) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ kind: "idle" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [reissued, setReissued] = useState<Reissued | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Looks up a target (email, license key or license id). Returns the licenses, or null after showing an error. */
  const runLookup = useCallback(async (value: string): Promise<License[] | null> => {
    setLookup({ kind: "loading" });
    try {
      const { status, data } = await adminRequest({ action: "lookup", target: value });
      if (status === 401) {
        onSignedOut();
        return null;
      }
      if (status === 400) {
        setLookup({ kind: "error", message: "That doesn't look like an email address, a license key or a license ID." });
        return null;
      }
      if (status !== 200 || !Array.isArray(data?.licenses)) {
        setLookup({ kind: "error", message: "Couldn't look that up. Please try again." });
        return null;
      }
      setLookup({ kind: "done", licenses: data.licenses as License[] });
      return data.licenses as License[];
    } catch {
      setLookup({ kind: "error", message: "Couldn't reach the server. Please try again." });
      return null;
    }
  }, [onSignedOut]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = query.trim();
    if (!value || lookup.kind === "loading") return;
    setNotice(null);
    setReissued(null);
    setTarget(value);
    await runLookup(value);
  }

  async function showLicense(lid: string) {
    setQuery(lid);
    setTarget(lid);
    setNotice(null);
    await runLookup(lid);
  }

  /** Runs a confirmed action, then refreshes the lookup. Returns an error message to show in the dialog, or null. */
  async function perform(p: Pending, reason: string): Promise<string | null> {
    const body: Record<string, string> = { action: p.action, target: p.license.lid };
    if (p.action === "revoke") body.reason = reason;
    const result = await adminRequest(body).catch(() => null);
    if (!result) return "Couldn't reach the server. Nothing was changed that I know of; look the license up again to check.";
    const { status, data } = result;
    if (status === 401) {
      onSignedOut();
      return "Your sign-in has expired. Sign in again.";
    }
    if (status !== 200) return "That didn't work. Look the license up again to see where it stands.";

    const id = shortId(p.license.lid);
    if (p.action === "revoke") {
      setNotice(data?.result === "already" ? `${id} was already revoked.` : data?.result === "unknown" ? `${id} wasn't found.` : `Revoked ${id}.`);
    } else if (p.action === "unrevoke") {
      setNotice(data?.result === "restored" ? `Restored ${id}.` : `${id} wasn't restored${data?.reason ? ` (${String(data.reason).replace(/_/g, " ")})` : ""}.`);
    } else if (data?.result === "reissued" || data?.result === "already") {
      setReissued({ newLid: data.newLid, oldLid: data.oldLid, emailed: Boolean(data.emailed), license: data.license, email: p.license.email });
      setNotice(data.result === "already" ? `${id} had already been replaced; here is the existing replacement.` : null);
    } else {
      setNotice(data?.result === "refused" ? `${id} can't be reissued (${REVOKE_REASONS[String(data.reason)] ?? "refused"}).` : `${id} wasn't found.`);
    }
    if (p.action !== "reissue") setReissued(null);
    if (target) await runLookup(target);
    return null;
  }

  const licenses = lookup.kind === "done" ? lookup.licenses : [];

  return (
    <>
      <form onSubmit={submit} className={`mt-6 ${panel}`}>
        <label htmlFor="admin-query" className="text-lg font-medium">Find a license</label>
        <p id="admin-query-hint" className="mt-1 text-sm text-tessera-panel-muted">Buyer's email, license key or license ID.</p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input id="admin-query" name="query" type="text" required autoComplete="off" autoCapitalize="off" spellCheck={false}
            aria-describedby="admin-query-hint" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="buyer@example.com"
            className="min-w-0 flex-1 rounded-xl border border-tessera-panel-line bg-tessera-panel-deep px-4 py-3 text-lg text-tessera-panel-ink placeholder:text-tessera-panel-muted focus:outline-2 focus:outline-offset-2 focus:outline-tessera-accent" />
          <button type="submit" disabled={lookup.kind === "loading"} className={primaryButton}>
            {lookup.kind === "loading" ? "Looking…" : "Look up"} <span aria-hidden="true">→</span>
          </button>
        </div>
      </form>

      <div aria-live="polite" className="mt-6">
        {notice && <p className="rounded-xl border border-tessera-panel-line bg-tessera-panel px-4 py-3 text-tessera-panel-ink">{notice}</p>}
        {lookup.kind === "error" && <p role="alert" className="mt-3 text-tessera-warn">{lookup.message}</p>}
      </div>

      {reissued && <ReissuedKey info={reissued} onShow={() => showLicense(reissued.newLid)} onDismiss={() => setReissued(null)} />}

      {lookup.kind === "done" && licenses.length === 0 && (
        <p className="mt-6 text-lg text-muted-foreground">No license found for that.</p>
      )}

      <ul className="mt-6 space-y-4">
        {licenses.map((l) => (
          <LicenseCard key={l.lid} license={l} onAction={(action) => setPending({ action, license: l })} />
        ))}
      </ul>

      {pending && (
        <ConfirmDialog pending={pending} onCancel={() => setPending(null)}
          onConfirm={async (reason) => {
            const error = await perform(pending, reason);
            if (!error) setPending(null);
            return error;
          }} />
      )}
    </>
  );
}

function StatusBadge({ license }: { license: License }) {
  const base = "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium";
  const payment = license.paymentStatus ? (
    <span className={`${base} border-tessera-warn/50 text-tessera-warn`}>Payment {(PAYMENT_STATUS[license.paymentStatus] ?? license.paymentStatus).toLowerCase()}</span>
  ) : null;
  let status: ReactNode;
  if (license.replacedBy) status = <span className={`${base} border-tessera-panel-line bg-tessera-panel-deep text-tessera-panel-muted`}>Replaced by {shortId(license.replacedBy)}</span>;
  else if (license.revokedAt) {
    const why = REVOKE_REASONS[String(license.revokeReason)] ?? String(license.revokeReason ?? "revoked");
    status = <span className={`${base} border-tessera-warn/50 text-tessera-warn`}>Revoked: {why}</span>;
  } else status = <span className={`${base} border-tessera-accent/50 text-tessera-accent`}>Active</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {status}
      {payment}
    </span>
  );
}

function LicenseCard({ license, onAction }: { license: License; onAction: (a: Pending["action"]) => void }) {
  const { copied, failed, copy } = useCopy();
  const replaced = Boolean(license.replacedBy);
  const revoked = Boolean(license.revokedAt);
  const reason = String(license.revokeReason);
  const paymentStatus = license.paymentStatus;
  // A refunded or disputed payment can't be undone from here, whatever else revoked the license first.
  const adminRevoked = revoked && (reason === "leaked" || reason === "manual") && !paymentStatus;
  const canRevoke = !revoked && !replaced;
  const canUnrevoke = adminRevoked && !replaced;
  const canReissue = !replaced && !paymentStatus && (!revoked || adminRevoked);

  return (
    <li className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge license={license} />
        <button type="button" title={license.lid} onClick={() => copy(license.lid, license.lid)}
          className="rounded-lg bg-tessera-panel-deep px-3 py-1 font-mono text-sm hover:opacity-80" aria-label={`Copy license ID ${license.lid}`}>
          {copied === license.lid ? "Copied" : shortId(license.lid)}
        </button>
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-tessera-panel-muted">Email</dt>
        <dd className="break-all">{license.email}</dd>
        <dt className="text-tessera-panel-muted">Issued</dt>
        <dd>{formatDate(license.issuedAt)}</dd>
        <dt className="text-tessera-panel-muted">License email</dt>
        <dd>{license.emailedAt ? `Sent ${formatDateTime(license.emailedAt)}` : revoked ? "Not sent" : "Not sent yet, retried nightly"}</dd>
        {license.reissuedFrom && (
          <>
            <dt className="text-tessera-panel-muted">Replaces</dt>
            <dd className="font-mono" title={license.reissuedFrom}>{shortId(license.reissuedFrom)}</dd>
          </>
        )}
        {revoked && license.revokedAt && (
          <>
            <dt className="text-tessera-panel-muted">Revoked</dt>
            <dd>{formatDate(license.revokedAt)}</dd>
          </>
        )}
        {paymentStatus && (
          <>
            <dt className="text-tessera-panel-muted">Payment</dt>
            <dd>{PAYMENT_STATUS[paymentStatus] ?? paymentStatus}{license.paymentRevokedAt ? ` on ${formatDate(license.paymentRevokedAt)}` : ""}</dd>
          </>
        )}
      </dl>
      {failed && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. The full ID is {license.lid}.</p>}
      {(canRevoke || canUnrevoke || canReissue) ? (
        <div className="mt-5 flex flex-wrap gap-3">
          {canRevoke && <button type="button" onClick={() => onAction("revoke")} className={quietButton}>Revoke…</button>}
          {canUnrevoke && <button type="button" onClick={() => onAction("unrevoke")} className={quietButton}>Unrevoke…</button>}
          {canReissue && <button type="button" onClick={() => onAction("reissue")} className={quietButton}>Reissue…</button>}
        </div>
      ) : (
        <p className="mt-5 text-sm text-tessera-panel-muted">
          {paymentStatus
            ? `The payment was ${paymentStatus === "refund" ? "refunded" : "disputed"}, so this license stays revoked. Refunds and disputes are handled in Stripe; unrevoke and reissue aren't available.`
            : replaced ? "This license has been replaced; nothing more to do." : "Refunds and disputes are handled by Stripe, so there are no actions here."}
        </p>
      )}
    </li>
  );
}

function ReissuedKey({ info, onShow, onDismiss }: { info: Reissued; onShow: () => void; onDismiss: () => void }) {
  const { copied, failed, copy } = useCopy();
  return (
    <section aria-labelledby="reissued-title" className={`mt-6 ${panel}`}>
      <h2 id="reissued-title" className="text-2xl font-medium">New key for {info.email}</h2>
      <p className="mt-2 text-tessera-panel-muted">
        {info.emailed
          ? "The new key has been emailed to the buyer. The old key is revoked."
          : "The email to the buyer did not go out (it will be retried by the daily job). Send them this key yourself if needed. The old key is revoked."}
      </p>
      <p className="mt-4 select-all break-all rounded-xl bg-tessera-panel-deep p-4 font-mono text-sm leading-relaxed">{info.license}</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={() => copy(info.license, "key")} className={primaryButton}>{copied === "key" ? "Copied" : "Copy key"}</button>
        <button type="button" onClick={onShow} className={quietButton}>Show new license</button>
        <button type="button" onClick={onDismiss} className={quietButton}>Hide key</button>
      </div>
      {failed && <p className="mt-3 text-sm text-tessera-warn">Couldn't copy automatically. Select the key above and copy it.</p>}
    </section>
  );
}

function describe(p: Pending, reason: string): ReactNode {
  const id = shortId(p.license.lid);
  const who = p.license.email;
  if (p.action === "revoke") {
    return (
      <>
        <p>This adds license <span className="font-mono">{id}</span> ({who}) to the revocation list as <strong>{reason}</strong>.</p>
        <p>Tessera stops accepting the key the next time it fetches the list (about weekly). The buyer is not emailed. You can unrevoke it later.</p>
      </>
    );
  }
  if (p.action === "unrevoke") {
    return (
      <>
        <p>This takes license <span className="font-mono">{id}</span> ({who}) off the revocation list, so the same key works again.</p>
        <p>The buyer is not emailed.</p>
      </>
    );
  }
  return (
    <>
      <p>This signs a new key for {who}, <strong>emails it to the buyer</strong>, and revokes the old key <span className="font-mono">{id}</span>.</p>
      <p>The old key stops working once Tessera next fetches the revocation list. Doing it twice is safe: the second time returns the same replacement.</p>
    </>
  );
}

const TITLES: Record<Pending["action"], string> = { revoke: "Revoke this license?", unrevoke: "Restore this license?", reissue: "Reissue this license?" };
const CONFIRM: Record<Pending["action"], string> = { revoke: "Revoke", unrevoke: "Unrevoke", reissue: "Reissue and email" };

function ConfirmDialog({ pending, onCancel, onConfirm }: {
  pending: Pending;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("leaked");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    const message = await onConfirm(reason);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <dialog ref={ref} aria-labelledby="confirm-title" onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
      onClick={(e) => { if (e.target === ref.current && !busy) onCancel(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-tessera-panel-line bg-tessera-panel p-0 text-tessera-panel-ink backdrop:bg-black/50">
      <div className="p-6">
        <h2 id="confirm-title" className="text-2xl font-medium">{TITLES[pending.action]}</h2>
        <div className="mt-3 space-y-3 leading-relaxed text-tessera-panel-muted">{describe(pending, reason)}</div>

        {pending.action === "revoke" && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Reason</legend>
            <label className="mt-2 flex items-start gap-2">
              <input type="radio" name="reason" value="leaked" checked={reason === "leaked"} onChange={() => setReason("leaked")} className="mt-1" />
              <span><strong className="font-medium">Leaked</strong><span className="block text-sm text-tessera-panel-muted">The key was shared or posted publicly.</span></span>
            </label>
            <label className="mt-2 flex items-start gap-2">
              <input type="radio" name="reason" value="manual" checked={reason === "manual"} onChange={() => setReason("manual")} className="mt-1" />
              <span><strong className="font-medium">Manual</strong><span className="block text-sm text-tessera-panel-muted">Any other reason.</span></span>
            </label>
          </fieldset>
        )}

        {error && <p role="alert" className="mt-4 text-tessera-warn">{error}</p>}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={busy} className={quietButton}>Cancel</button>
          <button type="button" onClick={confirm} disabled={busy} className={primaryButton}>{busy ? "Working…" : CONFIRM[pending.action]}</button>
        </div>
      </div>
    </dialog>
  );
}
