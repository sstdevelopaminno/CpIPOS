from pathlib import Path

path = Path("apps/backoffice-web/src/app/api/pos/table-qr-timeline/route.ts")
s = path.read_text(encoding="utf-8-sig")
old = '    const products = new Map((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));\n'
new = '    const products = new Map<string, { name: string; sku: string | null }>((productResult.data ?? []).map((row: { id: string; sku: string | null; name: string }) => [row.id, { name: row.name, sku: row.sku }]));\n'

if old in s:
    if s.count(old) != 1:
        raise SystemExit(f"timeline product map: expected 1 exact match, got {s.count(old)}")
    path.write_text(s.replace(old, new, 1), encoding="utf-8")
elif new in s:
    # The original typefix has already been applied.
    pass
elif (
    'type ProductLookupRow = { id: string; sku: string | null; name: string };' in s
    and 'type ProductLookup = { name: string; sku: string | null };' in s
    and 'const products = new Map<string, ProductLookup>(' in s
):
    # A newer, stricter typed implementation supersedes this patch.
    pass
else:
    raise SystemExit("timeline product map: no recognized typed implementation found")
