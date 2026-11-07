"use client";

import { useEffect, useState } from "react";
import { MOBILE_MEDIA_QUERY } from "./floating-window";

/** 是否移动端断点（与 Header 抽屉、世界频道一致：max-width 700px）。 */
export function useIsMobile(query: string = MOBILE_MEDIA_QUERY): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [query]);
  return isMobile;
}
