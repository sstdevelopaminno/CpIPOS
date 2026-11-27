"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  lang: "th" | "en";
  dateLabel: string;
  timeLabel: string;
  fixedDocumentTime?: string | null;
};

export function PosRealtimeClock({ lang, dateLabel, timeLabel, fixedDocumentTime }: Props) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    if (fixedDocumentTime) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [fixedDocumentTime]);

  const effectiveNow = useMemo(() => fixedDocumentTime ? new Date(fixedDocumentTime) : now, [fixedDocumentTime, now]);

  const displayDate = useMemo(
    () =>
      effectiveNow
        ? new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
            dateStyle: "medium",
            timeZone: "Asia/Bangkok"
          }).format(effectiveNow)
        : "--",
    [lang, effectiveNow]
  );

  const displayTime = useMemo(
    () =>
      effectiveNow
        ? new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "Asia/Bangkok"
          }).format(effectiveNow)
        : "--:--:--",
    [lang, effectiveNow]
  );

  return (
    <>
      <div className="posui-sales-meta-row">
        <dt>{dateLabel}</dt>
        <dd>{displayDate}</dd>
      </div>
      <div className="posui-sales-meta-row">
        <dt>{timeLabel}</dt>
        <dd>{displayTime}</dd>
      </div>
    </>
  );
}
