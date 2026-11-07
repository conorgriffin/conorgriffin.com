import { PageIntro, TesseraLayout, email, paths } from "./Layout";
import { TileBullet } from "./TesseraIcon";

const faqs: [string, string][] = [
  ["Does Tessera send my tokens anywhere?", "No. Everything is processed on your Mac. The only network request is when you choose Fetch keys from issuer, which contacts that issuer directly."],
  ["How do I restore Tessera Pro?", "In the App Store version, open Tessera › Tessera Pro… and choose Restore Purchase, or go to Settings › Purchases."],
  ["I bought Tessera Pro on your website. How do I get my license again?", "Go to conorgriffin.com/tessera/license and enter the email you bought with. I'll send your license again. Then open Tessera, choose Enter License… and paste it."],
  ["Is Tessera Pro a subscription?", "No, it's a one-time purchase."],
  ["Which algorithms are supported?", "For signed tokens (JWS): HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA. For encrypted tokens (JWE): RSA-OAEP, ECDH-ES (P-256, P-384, P-521, X25519), AES key wrap, PBES2 and direct keys."],
  ["How do I show the menu bar item?", "Settings › General › Show menu bar item (Tessera Pro)."],
  ["What macOS version do I need?", "macOS 15 or later."],
];

export function SupportPage() {
  const mailto = `mailto:${email}?subject=${encodeURIComponent("Tessera support")}`;
  return (
    <TesseraLayout current="support">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Support" subtitle="Tessera for Mac" />

        <section aria-labelledby="contact-title" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 id="contact-title" className="text-2xl font-medium md:text-3xl">Get in touch</h2>
          <p className="mt-3 text-lg leading-relaxed">
            Email me at <a href={mailto} className="break-all font-medium text-tessera-accent underline underline-offset-4">{email}</a> and I'll get back to you.
          </p>
          <p className="mt-5 text-sm text-tessera-panel-muted">It helps to include:</p>
          <ul className="mt-3 space-y-2 text-tessera-panel-muted">
            <li className="flex gap-3"><TileBullet i={0} />Your macOS version</li>
            <li className="flex gap-3"><TileBullet i={1} />Your Tessera version (Tessera › About Tessera)</li>
            <li className="flex gap-3"><TileBullet i={2} />Steps to reproduce the problem</li>
          </ul>
          <p className="mt-5 rounded-xl bg-tessera-panel-deep p-4 text-sm leading-relaxed">
            <strong className="font-medium text-tessera-warn">Please never send real tokens or private keys.</strong> Use a sample token, or redact the signature.
          </p>
          <a href={mailto} className="mt-6 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:opacity-90">Email support <span aria-hidden="true">→</span></a>
        </section>

        <section aria-labelledby="faq-title" className="reveal mt-16">
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-title" className="mt-3 text-3xl font-medium md:text-4xl">Common questions</h2>
          <div className="mt-8 divide-y border-y">
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium [&::-webkit-details-marker]:hidden">
                  <h3 className="font-sans text-lg font-medium tracking-normal">{q}</h3>
                  <span aria-hidden="true" className="text-xl text-muted-foreground transition group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
          <p className="mt-8 text-muted-foreground">
            More on how your data is handled in the <a href={paths.privacy} className="text-foreground underline underline-offset-4 hover:text-primary">privacy policy</a>.
          </p>
        </section>
      </div>
    </TesseraLayout>
  );
}
