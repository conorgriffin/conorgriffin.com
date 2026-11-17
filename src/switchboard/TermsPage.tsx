import { PageIntro, Part, SwitchboardLayout, email, paths } from "./Layout";

const link = "text-foreground underline underline-offset-4 hover:text-primary";

export function TermsPage() {
  return (
    <SwitchboardLayout current="terms">
      <article className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Terms of sale" subtitle="Audio Switchboard for Mac">
          <p className="mt-4 text-sm text-muted-foreground">Last updated: <time dateTime="2026-11-17">17 November 2026</time></p>
        </PageIntro>

        <section aria-label="Summary" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 className="eyebrow">Summary</h2>
          <p className="mt-3 text-lg leading-relaxed md:text-xl">Audio Switchboard is free to try for 14 days, then a one-time purchase unlocks it. If it isn't for you, ask for a refund within 14 days.</p>
        </section>

        <Part title="Who sells it">
          <p>The direct-download version of Audio Switchboard is sold by Stripe, as merchant of record, through Stripe Managed Payments. Stripe takes your payment, handles tax and sends your receipt. The app and the license are made by Conor Griffin.</p>
        </Part>
        <Part title="What you get">
          <p>Audio Switchboard works in full for 14 days after you first open it. After that, the menu still lists your devices and switches between them, and device shortcuts keep working. Auto-Switch (and any later automation features) pauses; your rules are kept. A one-time purchase unlocks them again.</p>
          <p>There's no subscription and the license doesn't expire. Your license key is emailed to you straight after you pay, and you can find it again on the <a href={paths.license} className={link}>find my license</a> page. The price and any tax are shown at checkout.</p>
        </Part>
        <Part title="Using your license">
          <p>A license is for your personal use, on your own Macs. Please don't share your key or post it publicly.</p>
        </Part>
        <Part title="Refunds">
          <p>You can ask for a refund within 14 days of buying, for any reason. Email <a href={`mailto:${email}`} className={link}>{email}</a> with the address you bought with.</p>
          <p>If a purchase is refunded or charged back, the license for it is deactivated. Audio Switchboard carries on in its locked state: your rules and settings are kept as they are. See the <a href={paths.privacy} className={link}>privacy policy</a> for how the app finds out about deactivated licenses.</p>
        </Part>
        <Part title="The Mac App Store version">
          <p>Audio Switchboard is also on the Mac App Store, where the unlock is bought separately through Apple under Apple's terms. A purchase in one version doesn't unlock the other.</p>
        </Part>
        <Part title="Contact">
          <p>Questions about an order: <a href={`mailto:${email}`} className={link}>{email}</a></p>
        </Part>
      </article>
    </SwitchboardLayout>
  );
}
