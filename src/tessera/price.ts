import { useEffect, useState } from "react";

/**
 * Tessera Pro's price in the visitor's currency (e.g. "€9.99"), fetched from Stripe via /api/tessera/price.
 * Undefined until it loads, while sales are closed, or if the lookup fails, so callers render without it.
 */
export function useProPrice(enabled: boolean): string | undefined {
  const [price, setPrice] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/tessera/price")
      .then((r) => (r.ok ? r.json() : undefined))
      .then((p: { currency?: string; amount?: number } | undefined) => {
        if (!live || !p?.currency || typeof p.amount !== "number") return;
        const format = new Intl.NumberFormat(undefined, { style: "currency", currency: p.currency.toUpperCase() });
        // Stripe amounts are in the currency's minor unit (cents, pence; yen has none).
        const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
        setPrice(format.format(p.amount / 10 ** digits));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [enabled]);
  return price;
}
