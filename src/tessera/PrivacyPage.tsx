import { PageIntro, Part, TesseraLayout, email } from "./Layout";

const link = "text-foreground underline underline-offset-4 hover:text-primary";

export function PrivacyPage() {
  return (
    <TesseraLayout current="privacy">
      <article className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Privacy policy" subtitle="Tessera for Mac">
          <p className="mt-4 text-sm text-muted-foreground">Last updated: <time dateTime="2026-11-07">7 November 2026</time></p>
        </PageIntro>

        <section aria-label="Summary" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 className="eyebrow">Summary</h2>
          <p className="mt-3 text-lg leading-relaxed md:text-xl">Tessera doesn't collect, store or share any personal data. There are no analytics, no advertising, no tracking and no account. The direct-download version has a few extra details, <a href="#direct" className="underline underline-offset-4">covered below</a>.</p>
        </section>

        <Part title="Your tokens and keys stay on your Mac">
          <p>Tokens you paste or open, and any keys you use, are processed entirely on your Mac. Saved keys (Tessera Pro) are stored in your macOS Keychain on this device only, optionally protected by Touch ID. Token history is encrypted on your Mac and you can clear it at any time in Settings.</p>
        </Part>
        <Part title="Clipboard">
          <p>Tessera reads the clipboard only on your Mac: when you paste, and, if you turn on clipboard watch (Tessera Pro, off by default), to notice tokens as you copy them. Clipboard watch only looks at plain text. Nothing read from the clipboard leaves your Mac.</p>
        </Part>
        <Part title="Network">
          <p>Tessera connects to the internet only when you ask it to fetch an issuer's public keys (Fetch keys from issuer). It then contacts that issuer directly over HTTPS, using OpenID Connect discovery and the issuer's JWKS. The request goes from your Mac to the issuer; I don't receive or see it. Nothing else is sent anywhere. (The direct-download version also makes the checks described below.)</p>
        </Part>
        <Part title="Purchases">
          <p>Tessera Pro is bought through the Mac App Store. Apple handles the transaction under <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noopener noreferrer" className={link}>Apple's privacy policy<span className="sr-only"> (opens in a new tab)</span></a>, and I don't receive your payment details.</p>
        </Part>
        <Part title="Direct-download version" id="direct">
          <p>You can also buy Tessera Pro on this website instead of the Mac App Store. This section covers that version. Everything above still applies: tokens, keys and the clipboard stay on your Mac.</p>
          <p>Purchases are processed by <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className={link}>Stripe<span className="sr-only"> (opens in a new tab)</span></a>, which sells Tessera Pro as the merchant of record. I don't receive your payment details. I store your email address and a random license ID, so I can deliver your license, send it again if you lose it, and deactivate it if the payment is refunded or disputed.</p>
          <p>License emails are sent with <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className={link}>Resend<span className="sr-only"> (opens in a new tab)</span></a>.</p>
          <p>About once a week, the app downloads a public list of deactivated licenses from conorgriffin.com. The request carries no license, email address or other identifier, only the app version. Tessera also uses Sparkle to check conorgriffin.com for new versions, without sending a system profile. This website is hosted on Vercel, which, like any web host, may process request details such as your IP address.</p>
        </Part>
        <Part title="Children">
          <p>Tessera doesn't collect data from anyone, including children.</p>
        </Part>
        <Part title="Changes">
          <p>If this policy changes, the updated version will be posted on this page with a new date.</p>
        </Part>
        <Part title="Contact">
          <p>Questions about privacy: <a href={`mailto:${email}`} className={link}>{email}</a></p>
        </Part>
      </article>
    </TesseraLayout>
  );
}
