import { TesseraLayout, paths } from "./Layout";
import { TesseraIcon, TileBullet, tileColors } from "./TesseraIcon";
import { EnlargeButton, LightboxProvider } from "./Lightbox";
import { useProPrice } from "./price";

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

const faqs: [string, string][] = [
  ["Is it really free?", "Yes. Decoding, verifying, decrypting, the security checks and building and signing tokens are all free, with no time limit. Tessera Pro adds saved keys, issuer key fetching, JWE encryption, the menu bar popover and history."],
  ["Is Tessera Pro a subscription?", "No. It's a one-time purchase, shown in your local currency at checkout."],
  ["Is the download safe to open?", "Yes. It's signed with my Apple Developer ID and notarized by Apple, so it opens like any other Mac app. Updates arrive inside the app."],
  ["What's the difference between this and the App Store version?", "It's the same app. The direct version updates itself and Tessera Pro is a license key sent by email. The App Store version uses Apple's in-app purchase. The two purchases are separate."],
  ["Does Tessera send my tokens anywhere?", "No. Everything happens on your Mac. The only network request is when you choose to fetch keys from an issuer, and that goes straight to the issuer."],
  ["What do I need?", "A Mac running macOS 15 or later."],
];

// The newest release, read from the Sparkle appcast at build time so the page never goes stale.
import appcast from "../../public/tessera/appcast.xml?raw";
const latest = (() => {
  const item = appcast.split("<item>")[1] ?? "";
  const version = item.match(/<sparkle:shortVersionString>([^<]+)</)?.[1];
  const date = item.match(/<pubDate>([^<]+)</)?.[1];
  const updated = date ? new Date(date).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : undefined;
  return { version, updated };
})();

const shot = (name: string) => ({
  src: `/tessera/screenshots/${name}-1600.webp`,
  srcSet: `/tessera/screenshots/${name}-960.webp 960w, /tessera/screenshots/${name}-1600.webp 1600w`,
});

/** A real window capture. Captures keep their rounded, transparent corners, so the shadow follows the window shape. */
function Screenshot({ name, alt, sizes, eager = false, className = "" }: { name: string; alt: string; sizes: string; eager?: boolean; className?: string }) {
  return (
    <EnlargeButton image={{ src: `/tessera/screenshots/${name}-2880.webp`, alt, width: 2880, height: 1800 }} className="rounded-[18px]">
      <img {...shot(name)} sizes={sizes} alt={alt} width={1600} height={1000}
        loading={eager ? "eager" : "lazy"} decoding="async"
        className={`h-auto w-full drop-shadow-[0_18px_40px_rgba(19,20,31,0.28)] ${className}`} />
    </EnlargeButton>
  );
}

const gallery: { name: string; title: string; caption: string; pro?: boolean }[] = [
  { name: "02-security", title: "Security checks in plain English", caption: "A remote key URL and an embedded key in the header, flagged before you trust the token." },
  { name: "03-claims", title: "Claims, not curly braces", caption: "Readable names, local times, and scopes and audiences as chips." },
  { name: "04-jwe", title: "JWE, inspected and decrypted", caption: "The protected header, the key it needs, and the nested signed token inside." },
  { name: "05-builder", title: "Build and sign", caption: "Edit claims as JSON with quick adds, then sign with any supported algorithm." },
  { name: "06-keys", title: "Keys in your Keychain", caption: "Name and tag the keys you use, optionally behind Touch ID.", pro: true },
];

// Hidden until launch: set VITE_TESSERA_SALES_OPEN=1 in Vercel (Production) and redeploy to show the
// "Get Tessera" section. The same variable also opens /tessera/buy and /tessera/download (api/tessera/*).
const salesOpen = import.meta.env.VITE_TESSERA_SALES_OPEN === "1";

export function TesseraPage() {
  const price = useProPrice(salesOpen);
  return (
    <LightboxProvider>
    <TesseraLayout current="home">
      <section aria-labelledby="hero-title" className="pt-16 md:pt-24">
        <div>
          <TesseraIcon size={88} animate />
          <p className="eyebrow mt-8">macOS app</p>
          <h1 id="hero-title" className="mt-3 text-6xl font-medium leading-[0.95] md:text-7xl">Tessera</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            A native Mac app for reading, verifying and building JSON Web Tokens. Paste a JWT or JWE and it answers the question you actually have: <em className="font-display text-foreground">is this token valid, and if not, why?</em>
          </p>
          {salesOpen ? (
            <>
              <p className="mt-5 text-sm text-muted-foreground">Free to download, with an optional one-time Tessera Pro upgrade. No subscription, no account.</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a href="/tessera/download" className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90">
                  Download free for Mac <span aria-hidden="true">↓</span>
                </a>
                <a href="/tessera/buy" className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition hover:bg-card">
                  Buy Pro{price && <span className="font-normal opacity-70">{price}</span>} <span aria-hidden="true">→</span>
                </a>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">{latest.version && <>Version {latest.version}{latest.updated && <>, updated {latest.updated}</>}. </>}Requires macOS 15 or later. Coming soon to the Mac App Store too. <a href="#get" className="text-foreground underline underline-offset-4 hover:text-primary">Compare the two</a>.</p>
            </>
          ) : (
            <>
              <p className="mt-5 text-sm text-muted-foreground">Free on the Mac App Store, with an optional one-time Tessera Pro upgrade. No subscription.</p>
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <span aria-disabled="true" className="inline-flex items-center gap-2 rounded-full bg-tessera-navy px-5 py-2.5 text-sm font-medium text-tessera-ink">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C7 7.2 5.6 8.1 4.8 9.5c-1.6 2.8-.4 6.9 1.1 9.2.8 1.1 1.7 2.3 2.8 2.3 1.1-.1 1.6-.7 3-.7s1.8.7 3 .7 2-1.1 2.7-2.2c.9-1.3 1.2-2.5 1.2-2.6 0 0-2.3-.9-2.2-3.6ZM14.2 5.6c.6-.7 1-1.7.9-2.6-.9 0-1.9.6-2.5 1.3-.6.6-1.1 1.6-.9 2.5 1 .1 1.9-.5 2.5-1.2Z" /></svg>
                  Coming soon to the Mac App Store
                </span>
                <span className="text-sm text-muted-foreground">Requires macOS 15 or later</span>
              </div>
            </>
          )}
        </div>
        <figure className="mt-14 md:mt-20">
          <div className="dark:hidden">
            <Screenshot name="01-verified" eager sizes="(min-width: 1024px) 976px, calc(100vw - 48px)"
              alt="Tessera showing a verified RS256 ID token: an expiry countdown, the decoded claims and passing security checks." />
          </div>
          <div className="hidden dark:block">
            <Screenshot name="08-dark" sizes="(min-width: 1024px) 976px, calc(100vw - 48px)"
              alt="Tessera in dark appearance showing a verified RS256 ID token with its payload as syntax-highlighted JSON." />
          </div>
        </figure>
      </section>

      <aside aria-label="Privacy" className="reveal mt-16 flex flex-col gap-4 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div className="flex items-start gap-4">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-tessera-accent" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <p className="text-lg leading-relaxed">Production tokens and keys don't belong in a website. Tessera does everything on your Mac: nothing is uploaded, there's no account, and the app collects no data.</p>
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

      <section aria-labelledby="tour-title" className="reveal pb-24">
        <p className="eyebrow">A closer look</p>
        <h2 id="tour-title" className="mt-3 text-4xl font-medium md:text-5xl">See it at work.</h2>
        <div className="mt-12 grid gap-x-10 gap-y-16 md:grid-cols-2">
          {gallery.map((g, i) => (
            <figure key={g.name}>
              <Screenshot name={g.name} alt={`${g.title}: ${g.caption}`} sizes="(min-width: 768px) 468px, calc(100vw - 48px)" />
              <figcaption className="mt-5">
                <p className="flex items-center gap-3 font-display text-xl font-medium">
                  <span aria-hidden="true" className={`h-3 w-3 rounded-[4px] ${tileColors[i % 4]}`} />
                  {g.title}
                  {g.pro && <span className="rounded-full bg-tessera-navy px-2 py-0.5 font-sans text-xs font-medium text-tessera-ink">Pro</span>}
                </p>
                <p className="mt-2 leading-relaxed text-muted-foreground">{g.caption}</p>
              </figcaption>
            </figure>
          ))}
          <figure className="flex flex-col">
            <div className="grid flex-1 place-items-center rounded-2xl bg-gradient-to-b from-[#3d7fb8] to-[#c9d3df] p-6">
              <EnlargeButton className="max-w-[406px] rounded-[18px]" image={{ src: "/tessera/screenshots/07-menubar-812.webp", width: 812, height: 666,
                alt: "The Tessera menu bar popover showing a JWT detected on the clipboard, with its subject, issuer and expiry." }}>
                <img src="/tessera/screenshots/07-menubar-812.webp" srcSet="/tessera/screenshots/07-menubar-406.webp 406w, /tessera/screenshots/07-menubar-812.webp 812w"
                sizes="(min-width: 768px) 406px, calc(100vw - 96px)" width={812} height={666} loading="lazy" decoding="async"
                alt="The Tessera menu bar popover showing a JWT detected on the clipboard, with its subject, issuer and expiry." className="h-auto w-full max-w-[406px]" />
              </EnlargeButton>
            </div>
            <figcaption className="mt-5">
              <p className="flex items-center gap-3 font-display text-xl font-medium">
                <span aria-hidden="true" className="h-3 w-3 rounded-[4px] bg-tile-amber" />
                Peek from the menu bar
                <span className="rounded-full bg-tessera-navy px-2 py-0.5 font-sans text-xs font-medium text-tessera-ink">Pro</span>
              </p>
              <p className="mt-2 leading-relaxed text-muted-foreground">Copy a token anywhere and see who it's for and when it expires, without switching apps.</p>
            </figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="pro-title" className="reveal pb-24">
        <div className="tessera-rule" />
        <p className="eyebrow mt-16">Tessera Pro</p>
        <h2 id="pro-title" className="mt-3 text-4xl font-medium md:text-5xl">More, if you want it.</h2>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">A one-time purchase{price && <> of {price}</>}. No subscription.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-[1fr_1.4fr]">
          <div className="rounded-2xl border bg-card p-7">
            <h3 className="text-2xl font-medium">Free</h3>
            <ul className="mt-5 space-y-3 text-muted-foreground">
              {free.map((p) => <li key={p} className="flex gap-3 leading-relaxed"><TileBullet i={2} />{p}</li>)}
            </ul>
          </div>
          <div className="rounded-2xl border border-tessera-panel-line bg-tessera-panel p-7 text-tessera-panel-ink">
            <h3 className="text-2xl font-medium">Pro <span className="ml-2 align-middle font-sans text-sm font-normal text-tessera-panel-muted">Everything in Free, plus</span></h3>
            <ul className="mt-5 space-y-3 text-tessera-panel-muted">
              {pro.map((p, i) => <li key={p} className="flex gap-3 leading-relaxed"><TileBullet i={i} />{p}</li>)}
            </ul>
          </div>
        </div>
      </section>

      {salesOpen && (
      <section id="get" aria-labelledby="get-title" className="reveal scroll-mt-24 pb-24">
        <div className="tessera-rule" />
        <p className="eyebrow mt-16">Get Tessera</p>
        <h2 id="get-title" className="mt-3 text-4xl font-medium md:text-5xl">Two ways to get it.</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="flex flex-col rounded-2xl border bg-card p-7">
            <h3 className="text-2xl font-medium">Mac App Store</h3>
            <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">Install it from the App Store. Tessera Pro is an in-app purchase.</p>
            <div className="mt-6">
              <span aria-disabled="true" className="inline-flex items-center gap-2 rounded-full bg-tessera-navy px-5 py-2.5 text-sm font-medium text-tessera-ink">Coming soon to the Mac App Store</span>
            </div>
          </div>
          <div className="flex flex-col rounded-2xl border bg-card p-7">
            <h3 className="text-2xl font-medium">Download directly</h3>
            <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">The same app as a download from this site, with updates built in. Tessera Pro is a one-time license key, emailed to you straight away.</p>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/tessera/download" className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90">Download <span aria-hidden="true">↓</span></a>
              <a href="/tessera/buy" className="inline-flex items-center gap-2 rounded-full border px-5 py-2.5 text-sm font-medium transition hover:bg-card">Buy Pro{price && <span className="font-normal opacity-70">{price}</span>} <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </div>
        <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
          The two versions are separate purchases: Pro bought in one doesn't unlock the other. Already bought directly? <a href={paths.license} className="text-foreground underline underline-offset-4 hover:text-primary">Find my license</a>. See the <a href={paths.terms} className="text-foreground underline underline-offset-4 hover:text-primary">terms of sale</a>.
        </p>
      </section>
      )}
      <section aria-labelledby="faq-title" className="reveal pb-24">
        <div className="tessera-rule" />
        <p className="eyebrow mt-16">Questions</p>
        <h2 id="faq-title" className="mt-3 text-4xl font-medium md:text-5xl">Before you download.</h2>
        <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {faqs.map(([q, a]) => (
            <div key={q}>
              <dt className="text-lg font-medium">{q}</dt>
              <dd className="mt-2 leading-relaxed text-muted-foreground">{a}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 text-sm text-muted-foreground">More answers on the <a href={paths.support} className="text-foreground underline underline-offset-4 hover:text-primary">support page</a>.</p>
      </section>
    </TesseraLayout>
    </LightboxProvider>
  );
}
