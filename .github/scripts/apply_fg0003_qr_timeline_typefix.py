from pathlib import Path

path = Path("apps/backoffice-web/src/app/api/pos/table-qr-timeline/route.ts")
s = path.read_text(encoding="utf-8-sig")
old = '    const products = new Map((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));\n'
new = '    const products = new Map<string, { name: string; sku: string | null }>((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));\n'
if s.count(old) != 1:
    raise SystemExit(f"timeline product map: expected 1 exact match, got {s.count(old)}")
path.write_text(s.replace(old, new, 1), encoding="utf-8")
