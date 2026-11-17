import { PageIntro, SwitchboardLayout, email, paths } from "./Layout";

const faqs: [string, string][] = [
  ["How does Audio Switchboard work?", "It runs in the menu bar, with no main window. Click its icon to see your connected audio devices, switch outputs and inputs, and open Settings."],
  ["How do I set up keyboard shortcuts?", "Choose Settings… from the menu and open the Shortcuts tab. Record one shortcut to cycle through your outputs, or give individual devices their own."],
  ["How does Auto-Switch work?", "In Settings, open the Auto-Switch tab and add a rule for each device you want picked. Rules are checked from the top, and the first one whose devices are all connected is used. A rule can also wait for another device, such as a dock, to be connected. If no rule matches, your current device is left as it is."],
  ["Can it switch microphones too?", "Yes. The menu lists your inputs below your outputs, and Auto-Switch has a separate Input list, so a USB mic can take over from a Bluetooth headset when it's plugged in."],
  ["What happens when the 14-day trial ends?", "The menu still lists your devices and switches between them, and device shortcuts keep working. Auto-Switch pauses until you unlock the app with a one-time purchase. Your rules are kept."],
  ["I bought Audio Switchboard on your website. How do I get my license again?", "Go to conorgriffin.com/switchboard/license and enter the email you bought with. I'll send your license again. Then open Settings › Purchase in the app and paste it."],
  ["A device I just connected isn't listed. What should I do?", "Bluetooth devices can take a few seconds to appear. If one still isn't there, press the Rescan button next to Output in the menu."],
  ["What macOS version do I need?", "macOS 14 (Sonoma) or later."],
];

export function SupportPage() {
  const mailto = `mailto:${email}?subject=${encodeURIComponent("Audio Switchboard support")}`;
  return (
    <SwitchboardLayout current="support">
      <div className="mx-auto max-w-2xl pb-24">
        <PageIntro title="Support" subtitle="Audio Switchboard for Mac" />

        <section aria-labelledby="contact-title" className="mt-10 rounded-2xl border border-tessera-panel-line bg-tessera-panel p-6 text-tessera-panel-ink md:p-8">
          <h2 id="contact-title" className="text-2xl font-medium md:text-3xl">Get in touch</h2>
          <p className="mt-3 text-lg leading-relaxed">
            Email me at <a href={mailto} className="break-all font-medium text-tessera-accent underline underline-offset-4">{email}</a> and I'll get back to you.
          </p>
          <p className="mt-5 text-sm text-tessera-panel-muted">It helps to include your macOS version, your Audio Switchboard version, which devices are involved, and the steps to reproduce the problem.</p>
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
    </SwitchboardLayout>
  );
}
