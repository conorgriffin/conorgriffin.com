import { useProPrice } from "../tessera/price";
import { APP_STORE_URL, PageIntro, SwitchboardIcon, SwitchboardLayout, buyPath, downloadPath, paths } from "./Layout";

// Hidden until launch: set VITE_SWITCHBOARD_SALES_OPEN=1 in Vercel (Production) and redeploy to show Download and Buy.
// The same variable opens /switchboard/buy and /switchboard/download (api/[app]/go.js). Until then the page links to
// the Mac App Store listing only.
const salesOpen = import.meta.env.VITE_SWITCHBOARD_SALES_OPEN === "1";

const features: [string, string][] = [
  ["Switch from the menu bar", "Every output and input device is listed in the menu. One click, or a keyboard shortcut, makes one the default."],
  ["Auto-Switch rules", "Put your devices in priority order for outputs and for inputs. When a better device connects, Audio Switchboard switches to it."],
  ["Rules that depend on each other", "A rule can wait for another device, such as a dock, to be connected before it applies."],
  ["Global shortcuts", "Cycle through your outputs with one shortcut, or give individual devices their own."],
];

const button = "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition";

export function SwitchboardPage() {
  const price = useProPrice(salesOpen, "switchboard");
  return (
    <SwitchboardLayout current="home">
      <section aria-labelledby="hero-title" className="pt-16 md:pt-24">
        <SwitchboardIcon size={88} />
        <p className="eyebrow mt-8">macOS app</p>
        <h1 id="hero-title" className="mt-3 text-5xl font-medium leading-[0.95] md:text-7xl">Audio Switchboard</h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground md:text-xl">
          A menu bar app for switching your Mac's audio output and input devices, by hand or automatically by priority rules.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {salesOpen ? (
            <>
              <a href={downloadPath} className={`${button} bg-foreground text-background hover:opacity-90`}>Download for Mac <span aria-hidden="true">↓</span></a>
              <a href={buyPath} className={`${button} border hover:bg-card`}>Buy{price && <span className="font-normal opacity-70">{price}</span>} <span aria-hidden="true">→</span></a>
              <a href={APP_STORE_URL} className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">or get it on the Mac App Store</a>
            </>
          ) : (
            <a href={APP_STORE_URL} className={`${button} bg-foreground text-background hover:opacity-90`}>View on the Mac App Store <span aria-hidden="true">→</span></a>
          )}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Requires macOS 14 or later. Everything is free for 14 days; after that, switching from the menu and shortcuts keep working and Auto-Switch is unlocked with a one-time purchase.</p>
      </section>

      <section aria-labelledby="features-title" className="reveal mt-16">
        <h2 id="features-title" className="sr-only">What it does</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {features.map(([title, body]) => (
            <div key={title} className="rounded-2xl border bg-card p-6">
              <h3 className="font-sans text-lg font-medium tracking-normal">{title}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="pb-24">
        <PageIntro title="Questions?" subtitle="Support">
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
            See the <a href={paths.support} className="text-foreground underline underline-offset-4 hover:text-primary">support page</a>, the <a href={paths.privacy} className="text-foreground underline underline-offset-4 hover:text-primary">privacy policy</a> or the <a href={paths.terms} className="text-foreground underline underline-offset-4 hover:text-primary">terms of sale</a>.
          </p>
        </PageIntro>
      </div>
    </SwitchboardLayout>
  );
}
