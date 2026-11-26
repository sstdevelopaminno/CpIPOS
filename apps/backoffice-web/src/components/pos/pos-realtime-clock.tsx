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
    if(fixedDocumentTime){setNow(new Date(fixedDocumentTime));return;}
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [fixedDocumentTime]);

  const displayDate = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
            dateStyle: "medium",
            timeZone: "Asia/Bangkok"
          }).format(now)
        : "--",
    [lang, now]
  );

  const displayTime = useMemo(
    () =>
      now
        ? new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
            timeZone: "Asia/Bangkok"
          }).format(now)
        : "--:--:--",
    [lang, now]
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
