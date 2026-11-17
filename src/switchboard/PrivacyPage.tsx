import { PageIntro, Part, SwitchboardLayout, email } from "./Layout";

const link = "text-foreground underline underline-offset-4 hover:text-primary";

export function PrivacyPage() {
  return (
    <SwitchboardLayout current="privacy">
      <article className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Privacy policy" subtitle="Audio Switchboard for Mac">
          <p className="mt-4 text-sm text-muted-foreground">Last updated: <time dateTime="2026-11-17">17 November 2026</time></p>
        </PageIntro>

        <section aria-label="Summary" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 className="eyebrow">Summary</h2>
          <p className="mt-3 text-lg leading-relaxed md:text-xl">Audio Switchboard never sends anything about you or your audio setup anywhere. There are no analytics, no advertising, no tracking and no account. The direct-download version has a few extra details, <a href="#direct" className="underline underline-offset-4">covered below</a>.</p>
        </section>

        <Part title="Your devices stay on your Mac">
          <p>Audio Switchboard reads the list of audio devices on your Mac to show them in the menu and to switch between them. Your devices, rules and settings are stored on your Mac and are not sent anywhere.</p>
        </Part>
        <Part title="Bluetooth">
          <p>Audio Switchboard works with Bluetooth audio devices only to switch to them and to apply the rules you set up. No Bluetooth data is collected or shared.</p>
        </Part>
        <Part title="Analytics and tracking">
          <p>The app contains no analytics, tracking or advertising code.</p>
        </Part>
        <Part title="Purchases in the Mac App Store version">
          <p>In the Mac App Store version, the unlock is bought through Apple under <a href="https://www.apple.com/legal/privacy/" target="_blank" rel="noopener noreferrer" className={link}>Apple's privacy policy<span className="sr-only"> (opens in a new tab)</span></a>, and I don't receive your payment details.</p>
        </Part>
        <Part title="Direct-download version" id="direct">
          <p>You can also buy Audio Switchboard on this website instead of the Mac App Store. This section covers that version. Everything above still applies: your devices, rules and settings stay on your Mac.</p>
          <p>Purchases are processed by <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className={link}>Stripe<span className="sr-only"> (opens in a new tab)</span></a>, which sells Audio Switchboard as the merchant of record, so your payment details are held by Stripe and I never receive them. I store your email address and a random license ID, so I can deliver your license, send it again if you lose it, and deactivate it if the payment is refunded or disputed.</p>
          <p>Your license is a signed key that contains your email address and the license ID. The app keeps it in your Mac's Keychain and checks it on your Mac. It does not send the key or your email address anywhere. License emails are sent with <a href="https://resend.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className={link}>Resend<span className="sr-only"> (opens in a new tab)</span></a>.</p>
          <p>While a license is installed, about once a week the app downloads a public list of deactivated licenses from conorgriffin.com. The request is a plain download that carries no license, email address or other identifier about you, only the app's name and version. If that check fails, the app carries on as before. The direct-download version also uses Sparkle to check conorgriffin.com for new versions, without sending a system profile.</p>
          <p>This website is hosted on Vercel, which, like any web host, may process request details such as your IP address. The website (not the app) uses Vercel Web Analytics to count page views and see which sites send visitors here. It uses no cookies and doesn't identify you or follow you across sites. Clicks on Download and Buy are also counted per day, as plain totals with nothing about you attached.</p>
        </Part>
        <Part title="Changes">
          <p>If this policy changes, the updated version will be posted on this page with a new date.</p>
        </Part>
        <Part title="Contact">
          <p>Questions about privacy: <a href={`mailto:${email}`} className={link}>{email}</a></p>
        </Part>
      </article>
    </SwitchboardLayout>
  );
}
