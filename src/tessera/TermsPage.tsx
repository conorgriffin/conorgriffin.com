import { PageIntro, Part, TesseraLayout, email, paths } from "./Layout";

const link = "text-foreground underline underline-offset-4 hover:text-primary";

export function TermsPage() {
  return (
    <TesseraLayout current="terms">
      <article className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Terms of sale" subtitle="Tessera for Mac">
          <p className="mt-4 text-sm text-muted-foreground">Last updated: <time dateTime="2026-11-07">7 November 2026</time></p>
        </PageIntro>

        <section aria-label="Summary" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 className="eyebrow">Summary</h2>
          <p className="mt-3 text-lg leading-relaxed md:text-xl">Tessera Pro is a one-time purchase. If it isn't for you, ask for a refund within 14 days.</p>
        </section>

        <Part title="Who sells it">
          <p>Tessera Pro for the direct-download version of Tessera is sold by Stripe, as merchant of record, through Stripe Managed Payments. Stripe takes your payment, handles tax and sends your receipt. The app and the license are made by Conor Griffin.</p>
        </Part>
        <Part title="What you get">
          <p>A one-time purchase that unlocks Tessera Pro in the direct-download version of Tessera. There's no subscription and the license doesn't expire. Your license key is emailed to you straight after you pay, and you can find it again on the <a href={paths.license} className={link}>find my license</a> page.</p>
          <p>The price and any tax are shown at checkout.</p>
        </Part>
        <Part title="Using your license">
          <p>A license is for your personal use, on your own Macs. Please don't share your key or post it publicly.</p>
        </Part>
        <Part title="Refunds">
          <p>You can ask for a refund within 14 days of buying, for any reason. Email <a href={`mailto:${email}`} className={link}>{email}</a> with the address you bought with.</p>
          <p>If a purchase is refunded or charged back, the license for it is deactivated. Tessera keeps working as the free version, and your saved keys and history stay on your Mac. See the <a href={paths.privacy} className={link}>privacy policy</a> for how the app finds out about deactivated licenses.</p>
        </Part>
        <Part title="The App Store version">
          <p>Tessera is also available on the Mac App Store, where Tessera Pro is bought separately through Apple under Apple's terms. A purchase in one version doesn't unlock the other.</p>
        </Part>
        <Part title="Contact">
          <p>Questions about an order: <a href={`mailto:${email}`} className={link}>{email}</a></p>
        </Part>
      </article>
    </TesseraLayout>
  );
}
