"use client";

import { useEffect } from "react";

// The type strip scrolls sideways on narrow screens; keep the selected type in view after navigation.
export function ExchangeTypeNavScroll({ current }: { current?: string }) {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".exchangeTypeNav");
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;
    nav.scrollLeft = tab.offsetLeft - nav.offsetLeft - (nav.clientWidth - tab.clientWidth) / 2;
  }, [current]);
  return null;
}
