import { TesseraLayout, paths } from "./Layout";
import { TesseraIcon, TileBullet, tileColors } from "./TesseraIcon";

const features: { title: string; points: string[] }[] = [
  {
    title: "Answers first",
    points: [
      "A live countdown to expiry, with a bar showing how much of the token's lifetime is left.",
      "A clear verdict: Verified, Invalid signature, Unsigned or Key needed.",
      "Plain-English security checks: alg none, expired or not-yet-valid tokens, missing audience, weak or well-known HMAC secrets.",
      "Warnings for remote key URLs and embedded keys in the header.",
    ],
  },
  {
    title: "Claims, not curly braces",
    points: [
      "Claims in a native grouped list with readable names, plus local and relative times.",
      "Scopes and audiences shown as chips.",
      "Syntax-highlighted JSON one keystroke away.",
      "Copy any value, or the whole token.",
    ],
  },
  {
    title: "Verify with any key",
    points: [
      "HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA.",
      "Paste a shared secret, PEM, X.509 certificate, JWK or JWKS (matched by kid).",
      "Guards against algorithm confusion attacks.",
    ],
  },
  {
    title: "JWE, too",
    points: [
      "See the protected header of any encrypted token and which key it needs.",
      "Decrypt with RSA-OAEP, ECDH-ES (P-256, P-384, P-521, X25519), AES key wrap, PBES2 or a direct key.",
      "Nested tokens decoded inline and verified in place.",
    ],
  },
  {
    title: "Build and sign",
    points: [
      "Edit the header and claims as a form or as JSON.",
      "Quick adds for exp, iat and jti.",
      "Sign with any supported algorithm using a pasted secret or private key.",
    ],
  },
  {
    title: "Made for the Mac",
    points: [
      "Built with SwiftUI and AppKit, in light and dark appearance.",
      "VoiceOver labels and full keyboard control.",
      "Open .jwt and .jwe files, or drag them onto the window.",
    ],
  },
];

const free = ["Decode, inspect and verify JWT and JWE", "Security checks and live expiry", "Decrypt JWE with any supported key", "Build and sign tokens"];
const pro = [
  "Saved keys in your Keychain, optionally protected by Touch ID",
  "Fetch keys from an issuer with OpenID Connect discovery and JWKS in one click",
  "Encrypt tokens as JWE, sign with saved keys, and start from OAuth and OIDC templates",
  "A menu bar popover and a global keyboard shortcut",
  "Clipboard watch that notices tokens as you copy them, on device",
  "Full history of up to 500 tokens, encrypted on your Mac, with Prod, Staging and Dev tags",
];

function TokenWindow() {
  const claims: [string, string][] = [
    ["iss", "https://auth.example.com"],
    ["sub", "user_8213"],
    ["aud", "api.example.com"],
  ];
  return (
    <figure aria-label="Tessera window showing a verified token" className="w-full overflow-hidden rounded-2xl border border-tessera-line bg-tessera-navy text-tessera-ink shadow-2xl">
      <div className="flex items-center gap-2 border-b border-tessera-line bg-tessera-navy-deep px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-tile-pink" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-tile-amber" aria-hidden="true" />
        <span className="h-3 w-3 rounded-full bg-tile-teal" aria-hidden="true" />
        <span className="ml-3 truncate text-xs text-tessera-ink-muted">access_token.jwt</span>
      </div>
      <div className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tessera-success/15 px-3 py-1 text-sm font-medium text-tessera-success">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
            Verified
          </span>
          <span className="text-xs text-tessera-ink-muted">RS256 · kid 2024-a</span>
        </div>
        <div>
          <div className="flex justify-between text-sm"><span>Expires in 42 min</span><span className="text-tessera-ink-muted">70%</span></div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tessera-line">
            <div className="h-full w-[70%] rounded-full bg-tile-teal" />
          </div>
        </div>
        <dl className="divide-y divide-tessera-line rounded-xl bg-tessera-navy-deep/60 text-sm">
          {claims.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
              <dt className="font-mono text-tessera-ink-muted">{k}</dt>
              <dd className="min-w-0 truncate font-mono">{v}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="font-mono text-tessera-ink-muted">scope</dt>
            <dd className="flex flex-wrap justify-end gap-1.5">
              <span className="rounded-full bg-tile-lavender/20 px-2 py-0.5 font-mono text-xs text-tile-lavender">read:tokens</span>
              <span className="rounded-full bg-tile-pink/20 px-2 py-0.5 font-mono text-xs text-tile-pink">write:tokens</span>
            </dd>
          </div>
        </dl>
      </div>
    </figure>
  );
}

export function TesseraPage() {
  return (
    <TesseraLayout current="home">
      <section aria-labelledby="hero-title" className="grid items-center gap-12 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
        <div>
          <TesseraIcon size={88} animate />
          <p className="eyebrow mt-8">macOS app</p>
          <h1 id="hero-title" className="mt-3 text-6xl font-medium leading-[0.95] md:text-7xl">Tessera</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            A native Mac app for reading, verifying and building JSON Web Tokens. Paste a JWT or JWE and it answers the question you actually have: <em className="font-display text-foreground">is this token valid, and if not, why?</em>
          </p>
          <p className="mt-5 text-sm text-muted-foreground">Free on the Mac App Store, with an optional one-time Tessera Pro upgrade. No subscription.</p>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <span aria-disabled="true" className="inline-flex items-center gap-2 rounded-full bg-tessera-navy px-5 py-2.5 text-sm font-medium text-tessera-ink">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C7 7.2 5.6 8.1 4.8 9.5c-1.6 2.8-.4 6.9 1.1 9.2.8 1.1 1.7 2.3 2.8 2.3 1.1-.1 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.7-2.2c.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.2-3.6ZM14.2 5.6c.6-.7 1-1.7.9-2.6-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.5 1 .1 1.9-.5 2.5-1.2Z" /></svg>
              Coming soon to the Mac App Store
            </span>
            <span className="text-sm text-muted-foreground">Requires macOS 15 or later</span>
          </div>
        </div>
        <TokenWindow />
      </section>

      <aside aria-label="Privacy" className="reveal flex flex-col gap-4 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div className="flex items-start gap-4">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-tessera-accent" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <p className="text-lg leading-relaxed">Everything happens on your Mac. Tokens and keys are never uploaded, there's no account, and the app collects no data.</p>
        </div>
        <a href={paths.privacy} className="shrink-0 text-sm font-medium text-tessera-accent underline-offset-4 hover:underline">Read the privacy policy →</a>
      </aside>

      <section aria-labelledby="features-title" className="reveal py-20 md:py-28">
        <p className="eyebrow">Features</p>
        <h2 id="features-title" className="mt-3 text-4xl font-medium md:text-5xl">Built to answer, not just decode.</h2>
        <div className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {features.map((f, i) => (
            <article key={f.title}>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className={`h-4 w-4 rounded-[5px] ${tileColors[i % 4]}`} />
                <h3 className="text-2xl font-medium">{f.title}</h3>
              </div>
              <ul className="mt-5 space-y-3">
                {f.points.map((p) => (
                  <li key={p} className="flex gap-3 leading-relaxed text-muted-foreground"><TileBullet i={i} />{p}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="pro-title" className="reveal pb-24">
        <div className="tessera-rule" />
        <p className="eyebrow mt-16">Tessera Pro</p>
        <h2 id="pro-title" className="mt-3 text-4xl font-medium md:text-5xl">More, if you want it.</h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">A one-time purchase. No subscription, and Family Sharing is supported.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-[1fr_1.4fr]">
          <div className="rounded-2xl border bg-card p-7">
            <h3 className="text-2xl font-medium">Free</h3>
            <ul className="mt-5 space-y-3 text-muted-foreground">
              {free.map((p) => <li key={p} className="flex gap-3 leading-relaxed"><TileBullet i={2} />{p}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-tessera-line bg-tessera-navy p-7 text-tessera-ink">
            <h3 className="text-2xl font-medium">Pro <span className="ml-2 align-middle font-sans text-sm font-normal text-tessera-ink-muted">Everything in Free, plus</span></h3>
            <ul className="mt-5 space-y-3 text-tessera-ink-muted">
              {pro.map((p, i) => <li key={p} className="flex gap-3 leading-relaxed"><TileBullet i={i} />{p}</li>)}
            </ul>
          </div>
        </div>
      </section>
    </TesseraLayout>
  );
}
