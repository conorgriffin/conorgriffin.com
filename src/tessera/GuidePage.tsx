import type { ReactNode } from "react";
import { PageIntro, TesseraLayout, paths } from "./Layout";
import { tileColors } from "./TesseraIcon";

/** A key or shortcut, e.g. <K>⌘V</K>. */
const K = ({ children }: { children: ReactNode }) => (
  <kbd className="rounded-md border bg-card px-1.5 py-0.5 font-sans text-[0.9em] text-foreground">{children}</kbd>
);
/** A menu, button or setting name as it appears in the app. */
const UI = ({ children }: { children: ReactNode }) => <strong className="font-medium text-foreground">{children}</strong>;

type Guide = { id: string; title: string; pro?: boolean; intro: ReactNode; steps: ReactNode[]; tip?: ReactNode };

const guides: Guide[] = [
  {
    id: "inspect",
    title: "Check a token",
    intro: "Find out who a token is for, when it expires and whether anything about it looks wrong.",
    steps: [
      <>Copy a JWT or JWE and press <K>⌘V</K> in Tessera. You can also drop a <code>.jwt</code> or <code>.jwe</code> file on the window, or open one with <K>⌘O</K>.</>,
      <>Read the verdict at the top: <UI>Verified</UI>, <UI>Invalid signature</UI>, <UI>Unsigned</UI> or <UI>Key needed</UI>, with a live countdown to expiry.</>,
      <>Look at <UI>Security checks</UI> for plain-English warnings, such as <code>alg: none</code>, an expired token, a missing audience, a weak HMAC secret, or a key URL in the header.</>,
      <>Switch between the claims list and the raw JSON with <K>⌘1</K> and <K>⌘2</K>. Show or hide the inspector with <K>⌥⌘I</K>.</>,
    ],
  },
  {
    id: "verify",
    title: "Verify a signature with a key",
    intro: "Check that a token was signed by the key you expect.",
    steps: [
      <>Open the token, then paste the key into the inspector's key field: a shared secret, a PEM public key or certificate, a JWK, or a whole JWKS.</>,
      <>With a JWKS, Tessera picks the key whose <code>kid</code> matches the token's header.</>,
      <>If the token carries its own certificate chain (<code>x5c</code>), choose <UI>Verify with Embedded Certificate</UI>. To check the chain against a root you trust, paste that root's PEM certificate into <UI>Trusted root</UI>.</>,
    ],
    tip: <>Tessera only accepts a key that matches the token's algorithm, which protects against algorithm-confusion attacks.</>,
  },
  {
    id: "issuer",
    title: "Fetch keys from the issuer",
    pro: true,
    intro: "Verify a token from an OpenID Connect provider without hunting for its public keys.",
    steps: [
      <>Open the token and choose <UI>Fetch keys from issuer</UI> in the inspector.</>,
      <>Tessera reads the token's <code>iss</code>, finds the issuer's key set through OpenID Connect discovery, and verifies with the key that matches <code>kid</code>.</>,
      <>Keys are cached for up to 24 hours. Choose <UI>Refresh</UI> to fetch them again, for example after the issuer rotates keys.</>,
    ],
    tip: <>This is the only time Tessera goes online. The request goes straight from your Mac to the issuer over HTTPS.</>,
  },
  {
    id: "jwe",
    title: "Decrypt a JWE",
    intro: "Read an encrypted token and the token nested inside it.",
    steps: [
      <>Paste the JWE. Tessera shows its protected header straight away, including which algorithm and which key it needs.</>,
      <>Paste the matching key into the inspector: an RSA or EC private key, a symmetric key, or the password for PBES2.</>,
      <>If the decrypted payload is itself a signed token, Tessera shows it inline. Open it as the current token to verify it with its own key.</>,
    ],
  },
  {
    id: "build",
    title: "Build and sign a token",
    intro: "Make a test token for a local API or an integration test.",
    steps: [
      <>Switch to <UI>Encode</UI> with <K>⇧⌘E</K>. Use <K>⇧⌘D</K> to get back to decoding.</>,
      <>Edit the header and claims as a form or as JSON. Quick adds fill in <code>exp</code>, <code>iat</code>, <code>nbf</code> and <code>jti</code>.</>,
      <>Pick a signing algorithm and paste a secret or private key, or fill in a random secret of the right length. Copy the token when you're done.</>,
      <>With Tessera Pro, start from an OAuth access token, ID token or service token template, sign with a saved key, or turn on <UI>Encrypt as JWE</UI>.</>,
    ],
  },
  {
    id: "keys",
    title: "Save keys in your Keychain",
    pro: true,
    intro: "Keep the keys you use every day one click away, and locked when you're not using them.",
    steps: [
      <>After pasting a key into the inspector, choose <UI>Save key to library</UI> and give it a name. You can also add keys in <UI>Settings › Keys</UI>.</>,
      <>Turn on <UI>Require Touch ID or password</UI> for any key you want to keep behind Touch ID.</>,
      <>Next time, choose the saved key in the inspector instead of pasting it.</>,
    ],
    tip: <>Saved keys stay in the Keychain on this Mac and are never synced or uploaded.</>,
  },
  {
    id: "menubar",
    title: "Peek at tokens from the menu bar",
    pro: true,
    intro: "See who a copied token is for and when it expires, without switching apps.",
    steps: [
      <>In <UI>Settings › General</UI>, turn on <UI>Show menu bar item</UI>. Turn on <UI>Global shortcut</UI> to open it from any app with <K>⌃⌥⌘J</K>, or record a shortcut of your own.</>,
      <>In <UI>Settings › Privacy</UI>, turn on <UI>Watch the clipboard for tokens</UI>. Tessera then notices tokens as you copy them.</>,
      <>Click the menu bar item to see the token's subject, issuer, expiry and verdict, then <UI>Copy payload</UI> or <UI>Open in Tessera</UI>.</>,
    ],
    tip: <>Clipboard watch is off until you turn it on. It only reads plain text, and keeps nothing unless it's a token.</>,
  },
  {
    id: "license",
    title: "Activate a license from this website",
    intro: "For Tessera Pro bought on this site rather than the Mac App Store.",
    steps: [
      <>Copy the license key from your purchase email. It starts with <code>TSR1-</code>.</>,
      <>In Tessera, open <UI>Settings › Purchases</UI>, choose <UI>Enter License…</UI>, paste the key and choose <UI>Activate</UI>.</>,
      <>Moving to a new Mac? Activate the same key there. To remove it from an old Mac, choose <UI>Deactivate on This Mac…</UI>.</>,
      <>Lost the email? <a href={paths.license} className="text-foreground underline underline-offset-4 hover:text-primary">Find my license</a> sends it again.</>,
    ],
  },
];

export function GuidePage() {
  return (
    <TesseraLayout current="guide">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Guide" subtitle="Tessera for Mac">
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">Short how-tos for the things people do most. Everything here happens on your Mac.</p>
        </PageIntro>

        <nav aria-label="On this page" className="mt-10">
          <ol className="grid gap-2 sm:grid-cols-2">
            {guides.map((g, i) => (
              <li key={g.id}>
                <a href={`#${g.id}`} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm font-medium transition hover:border-primary/50">
                  <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-[4px] ${tileColors[i % 4]}`} />
                  {g.title}
                  {g.pro && <span className="ml-auto rounded-full bg-tessera-navy px-2 py-0.5 text-xs font-medium text-tessera-ink">Pro</span>}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {guides.map((g, i) => (
          <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="mt-16 scroll-mt-24">
            <h2 id={`${g.id}-title`} className="flex flex-wrap items-center gap-3 text-2xl font-medium md:text-3xl">
              <span aria-hidden="true" className={`h-4 w-4 rounded-[5px] ${tileColors[i % 4]}`} />
              {g.title}
              {g.pro && <span className="rounded-full bg-tessera-navy px-2 py-0.5 font-sans text-xs font-medium text-tessera-ink">Pro</span>}
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-muted-foreground">{g.intro}</p>
            <ol className="mt-5 list-decimal space-y-3 pl-6 leading-relaxed text-muted-foreground marker:text-foreground">
              {g.steps.map((s, j) => <li key={j} className="pl-1">{s}</li>)}
            </ol>
            {g.tip && <p className="mt-5 rounded-xl border bg-card p-4 text-sm leading-relaxed text-muted-foreground">{g.tip}</p>}
          </section>
        ))}

        <p className="mt-16 text-muted-foreground">
          Stuck on something else? See <a href={paths.support} className="text-foreground underline underline-offset-4 hover:text-primary">Support</a> for common questions and how to get in touch.
        </p>
      </div>
    </TesseraLayout>
  );
}
