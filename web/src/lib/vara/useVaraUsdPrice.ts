"use client";

/**
 * Shared client hook wrapping price.ts's fetchVaraUsdPrice() -- every
 * component that shows a $ figure (wallet balance, stake input, My
 * Stakes) uses this instead of fetching independently, so they all
 * settle on the same cached price rather than each racing their own
 * request against CoinGecko's rate limit.
 */

import { useEffect, useState } from "react";
import { fetchVaraUsdPrice } from "./price";

/** null while loading or if the price couldn't be fetched -- callers
 * should render VARA-only in either case, see price.ts's fail-soft
 * contract. */
export function useVaraUsdPrice(): number | null {
  const [priceUsd, setPriceUsd] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchVaraUsdPrice().then((price) => {
      if (!cancelled) setPriceUsd(price);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return priceUsd;
}
