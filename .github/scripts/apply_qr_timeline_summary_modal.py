from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, got {count}")
    return text.replace(old, new, 1)


path = Path("apps/backoffice-web/src/components/pos-preview/table-qr-order-timeline.tsx")
s = path.read_text(encoding="utf-8-sig")

s = replace_once(
    s,
    '  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);\n',
    '  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);\n  const [summaryOpen, setSummaryOpen] = useState(false);\n',
    "summary modal state",
)

s = replace_once(
    s,
    '<p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">FG0003 · 7-Day Audit</p>',
    '<p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">QR ORDER · 7-Day Audit</p>',
    "generic timeline eyebrow",
)

s = replace_once(
    s,
    '<a href="/preview/pos/settings" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← กลับตั้งค่า</a>',
    '''<div className="flex flex-wrap items-center gap-2">\n              <button type="button" onClick={() => setSummaryOpen(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-blue-700">ดูสรุป QR</button>\n              <a href="/preview/pos/settings" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">← กลับตั้งค่า</a>\n            </div>''',
    "timeline header actions",
)

cards_block = '''        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">\n          {cards.map(([label, value]) => (\n            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">\n              <div className="text-xs font-bold text-slate-500">{label}</div>\n              <div className="mt-1 text-2xl font-black tabular-nums text-slate-950">{value}</div>\n            </div>\n          ))}\n        </div>\n\n'''
s = replace_once(s, cards_block, "", "remove inline summary cards")

truncated_block = '        {summary?.summary_truncated ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">สรุปด้านบนใช้เหตุการณ์ล่าสุดสูงสุด 5,000 รายการเพื่อรักษาความเร็ว ส่วนตารางยังเปิดดูต่อได้ทุกหน้าภายในช่วงเวลาที่เลือก</div> : null}\n'
s = replace_once(s, truncated_block, "", "move summary truncation note")

modal = '''      {summaryOpen ? (\n        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label="สรุปไทม์ไลน์ QR">\n          <button type="button" aria-label="ปิดสรุป QR" className="absolute inset-0 cursor-default" onClick={() => setSummaryOpen(false)} />\n          <section className="relative z-10 w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">\n            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">\n              <div>\n                <h2 className="text-xl font-black text-slate-950">สรุปไทม์ไลน์สั่งอาหารจาก QR</h2>\n                <p className="mt-1 text-sm font-semibold text-slate-500">ช่วงเวลาที่เลือก: {hours === 168 ? "7 วัน" : `${hours} ชั่วโมง`}</p>\n              </div>\n              <button type="button" onClick={() => setSummaryOpen(false)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">ปิด ✕</button>\n            </header>\n            <div className="max-h-[75vh] overflow-y-auto p-5">\n              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">\n                {cards.map(([label, value]) => (\n                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">\n                    <div className="text-xs font-bold text-slate-500">{label}</div>\n                    <div className="mt-1 text-3xl font-black tabular-nums text-slate-950">{value}</div>\n                  </div>\n                ))}\n              </div>\n              {summary?.summary_truncated ? <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">สรุปใช้เหตุการณ์ล่าสุดสูงสุด 5,000 รายการเพื่อรักษาความเร็ว ส่วนตารางยังเปิดดูต่อได้ทุกหน้าภายในช่วงเวลาที่เลือก</div> : null}\n            </div>\n          </section>\n        </div>\n      ) : null}\n\n'''
s = replace_once(
    s,
    '      {selectedEvent ? <TimelineEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}\n',
    modal + '      {selectedEvent ? <TimelineEventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} /> : null}\n',
    "timeline summary modal render",
)

path.write_text(s, encoding="utf-8")
