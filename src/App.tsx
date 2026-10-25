import { useEffect, useState, type ReactNode } from "react";
import { experience, education } from "@/content/experience";
import { apps } from "@/content/apps";
import { links } from "@/content/site";
import { now } from "@/content/now";
import { skills } from "@/content/skills";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);
const icons = {
  github: "M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z",
  linkedin: "M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2ZM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Zm1.8 13.1H3.5V9h3.6v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0Z",
  medium: "M13.5 12a6.75 6.75 0 1 1-13.5 0 6.75 6.75 0 0 1 13.5 0Zm7.4 0c0 3.5-1.5 6.3-3.4 6.3S14.2 15.5 14.2 12s1.5-6.3 3.3-6.3 3.4 2.8 3.4 6.3ZM24 12c0 3.1-.5 5.7-1.2 5.7s-1.2-2.6-1.2-5.7.5-5.7 1.2-5.7S24 8.9 24 12Z",
  email: "M2 5h20v14H2V5Zm2 2v.5l8 5 8-5V7H4Zm16 2.8-8 5-8-5V17h16V9.8Z",
};
const socials = [
  { label: "GitHub", href: links.github, d: icons.github },
  { label: "LinkedIn", href: links.linkedin, d: icons.linkedin },
  { label: "Medium", href: links.medium, d: icons.medium },
  { label: "Email", href: links.email, d: icons.email },
];

function Socials() {
  return (
    <ul className="flex gap-2">
      {socials.map((s) => (
        <li key={s.label}>
          <a
            href={s.href}
            aria-label={s.label}
            {...(s.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="grid h-11 w-11 place-items-center rounded-full border bg-card text-foreground transition hover:-translate-y-0.5 hover:border-primary hover:text-primary"
          >
            <Icon d={s.d} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* private mode */
    }
  };
  return (
    <button onClick={toggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="grid h-9 w-9 place-items-center rounded-full border text-foreground transition hover:text-primary">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {dark ? (
          <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        )}
      </svg>
    </button>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="reveal scroll-mt-24 py-20 md:py-28">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-4xl font-medium md:text-5xl">{title}</h2>
      <div className="mt-10">{children}</div>
    </section>
  );
}

const nav = [["About", "#about"], ["Now", "#now"], ["Experience", "#experience"], ["Apps", "#apps"], ["Writing", "#writing"]];

export function App() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("is-visible")),
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground">Skip to content</a>
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <a href="#top" className="font-display text-xl font-semibold">Conor Griffin<span className="text-primary">.</span></a>
          <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-5">
            <ul className="hidden gap-6 text-sm text-muted-foreground sm:flex">
              {nav.map(([l, h]) => <li key={h}><a href={h} className="transition hover:text-foreground">{l}</a></li>)}
            </ul>
            <ThemeToggle />
          </nav>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-6">
        <section id="top" className="flex min-h-[78vh] flex-col justify-center py-20">
          <p className="eyebrow animate-in fade-in slide-in-from-bottom-2 duration-700">Dublin, Ireland</p>
          <h1 className="mt-5 text-6xl font-medium leading-[0.95] md:text-8xl animate-in fade-in slide-in-from-bottom-4 duration-700">
            Conor Griffin<span className="text-primary">.</span>
          </h1>
          <p className="mt-8 max-w-2xl text-xl leading-relaxed text-muted-foreground md:text-2xl animate-in fade-in slide-in-from-bottom-4 duration-1000">
            Engineer and engineering leader at Workday. I work on integration tooling and how AI agents use it,
            and I make small, <em className="font-display text-foreground">thoughtful</em> apps for Apple platforms in my spare time.
          </p>
          <div className="mt-10 animate-in fade-in duration-1000"><Socials /></div>
        </section>

        <Section id="about" eyebrow="About" title="Hello, I'm Conor.">
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            I've spent around twenty years building and running software, starting as a systems programmer on
            IBM mainframe and HP NonStop machines at AIB, then moving into integration and microservices
            platforms at Mastercard. At Workday I've gone from engineer to principal engineer to leading teams
            on Workday Orchestrate, Workday's integration platform, and I've stayed hands-on the whole way:
            these days that means enabling Orchestrate for AI agents and MCP, and using agentic tooling to make
            our own engineering faster. I like the mix of deep technical work and helping a team do its best
            work, and I'd happily lean either way. In my spare time I ship small, thoughtful indie apps for
            Apple platforms, the kind of tools I want to use myself.
          </p>
        </Section>

        <Section id="now" eyebrow="Now" title="What I'm working on.">
          <div className="grid gap-6 md:grid-cols-3">
            {now.map((n) => (
              <article key={n.title} className="rounded-2xl border bg-card p-6 transition hover:border-primary/50 hover:shadow-lg">
                <h3 className="text-xl font-medium">{n.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{n.blurb}</p>
              </article>
            ))}
          </div>
          <ul className="mt-8 flex flex-wrap gap-2" aria-label="Skills">
            {skills.map((s) => (
              <li key={s} className="rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">{s}</li>
            ))}
          </ul>
        </Section>

        <Section id="experience" eyebrow="Experience" title="Where I've worked.">
          <ol className="relative max-w-3xl border-l pl-8">
            {experience.map((c, i) => (
              <li key={c.company} className="relative pb-12 last:pb-0">
                <span className={`absolute -left-[39px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-primary ${i === 0 ? "bg-primary" : "bg-background"}`} />
                <p className="text-sm text-muted-foreground">{c.start} — {c.end}{c.tenure && <> · {c.tenure}</>}</p>
                <h3 className="mt-1 text-2xl font-medium">{c.company}</h3>
                <p className="mt-1 text-sm font-medium text-primary">{c.location}</p>
                {c.summary && <p className="mt-2 text-muted-foreground">{c.summary}</p>}
                <ul className="mt-5 space-y-4 border-l pl-5">
                  {c.roles.map((r) => (
                    <li key={`${r.role} ${r.start}`}>
                      <p className="text-sm text-muted-foreground">{r.start} — {r.end}</p>
                      <p className="mt-0.5 font-medium">{r.role}</p>
                      {r.summary && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.summary}</p>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-10 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Education</span> · {education.school} — {education.degree}
          </p>
        </Section>

        <Section id="apps" eyebrow="Apps" title="Things I've made.">
          <div className="grid gap-6 md:grid-cols-2">
            {apps.map((a) => (
              <article key={a.name} className="group flex flex-col rounded-2xl border bg-card p-7 transition hover:-translate-y-1 hover:border-primary/50 hover:shadow-lg">
                <div className="flex flex-wrap gap-2">
                  {a.platforms.map((p) => (
                    <span key={p} className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">{p}</span>
                  ))}
                </div>
                <h3 className="mt-5 text-3xl font-medium">{a.name}</h3>
                {a.tagline && <p className="mt-1 font-display italic text-primary">{a.tagline}</p>}
                <p className="mt-3 flex-1 leading-relaxed text-muted-foreground">{a.blurb}</p>
                {a.status && <p className="mt-4 text-sm font-medium">{a.status}</p>}
                {a.url !== "#" ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                    className="mt-6 inline-flex w-fit items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:bg-primary hover:text-primary-foreground">
                    Visit website <span aria-hidden="true">↗</span><span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground">Website coming soon</p>
                )}
              </article>
            ))}
          </div>
        </Section>

        <Section id="writing" eyebrow="Writing" title="Notes from the workbench.">
          <div className="flex flex-col items-start gap-6 rounded-2xl border bg-accent/50 p-8 md:flex-row md:items-center md:justify-between md:p-10">
            <p className="max-w-lg text-lg text-muted-foreground">I write occasionally about software engineering, building indie apps and the lessons in between.</p>
            <a href={links.medium} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 font-medium text-primary-foreground transition hover:opacity-90">
              Read my writing on Medium <span aria-hidden="true">→</span>
            </a>
          </div>
        </Section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 px-6 py-10 sm:flex-row sm:items-center">
          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} Conor Griffin. Made in Dublin.</p>
          <Socials />
        </div>
      </footer>
    </div>
  );
}
