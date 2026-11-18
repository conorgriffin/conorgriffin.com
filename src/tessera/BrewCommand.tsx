import { useRef, useState } from "react";

/** The Homebrew cask in conorgriffin/homebrew-tap. It installs the direct-download build. */
export const brewCommand = "brew install --cask conorgriffin/tap/tessera";

type CopyState = "idle" | "copied" | "failed";

/** The Homebrew install command in a code block, with a copy button. */
export function BrewCommand({ className = "" }: { className?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const codeRef = useRef<HTMLElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(brewCommand);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      // Clipboard blocked: select the command so ⌘C works.
      const node = codeRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setState("failed");
    }
  }

  return (
    <div className={className}>
      <div className="flex max-w-xl items-center gap-3 rounded-xl border bg-card py-1.5 pl-4 pr-1.5">
        <span aria-hidden="true" className="select-none font-mono text-sm text-muted-foreground">$</span>
        <code ref={codeRef} className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1 font-mono text-sm text-foreground">{brewCommand}</code>
        <button type="button" onClick={copy} aria-label="Copy the Homebrew install command"
          className="shrink-0 rounded-lg border px-3 py-1 text-xs font-medium text-foreground transition hover:bg-background">
          {state === "copied" ? "Copied" : "Copy"}
        </button>
      </div>
      <p aria-live="polite" className="sr-only">{state === "copied" ? "Copied to the clipboard" : ""}</p>
      {state === "failed" && <p className="mt-2 text-sm text-tessera-warn">Couldn't copy automatically. The command is selected, so press ⌘C.</p>}
    </div>
  );
}
