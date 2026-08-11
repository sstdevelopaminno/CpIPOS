from pathlib import Path
import re

MARKER = "## Product Management header tabs + pagination follow-up — 2026-08-11"
NOTE = """

## Product Management header tabs + pagination follow-up — 2026-08-11

- Moved the existing `All / Unit Only / Ingredients` mode tabs into the top Stock Management action toolbar; the same React state and handlers remain authoritative.
- Removed the redundant `Product List` / `รายการสินค้า` heading from the body.
- Reduced the bounded product/ingredient table height from `56vh` to `45vh` and tightened pagination spacing so Previous / Page / Next sits higher on POS-class 1365x768 displays.
- Pagination remains 10 rows per page and no catalog, stock mutation, sales, receipt, shift, payment, tenant, or branch authorization logic changed.
- This is system-wide Web POS behavior; the physical POS terminal is the primary acceptance-test device only.
"""

for filename in ("README.md", "context.md"):
    path = Path(filename)
    text = path.read_text(encoding="utf-8-sig")
    if MARKER not in text:
        text = text.rstrip() + NOTE
    path.write_text(text.rstrip() + "\n", encoding="utf-8")

checkpoint = Path("docs/PRODUCT-MANAGEMENT-UI-CLEANUP-2026-08-11.md")
checkpoint_text = checkpoint.read_text(encoding="utf-8-sig")
if MARKER not in checkpoint_text:
    checkpoint_text = checkpoint_text.rstrip() + NOTE + """

### Follow-up acceptance

- Header toolbar shows the three stock-mode tabs and the five management actions in the same top action region.
- The body no longer renders the `Product List` / `รายการสินค้า` title or a duplicate mode-tab row.
- Product and ingredient table wrappers use `max-h-[45vh]`.
- Pagination footer remains immediately after the table and uses `mt-2`, so the Next button is materially higher than the prior `56vh` layout.
- Feature commit `cdf410df79bfb34bbf047f418a83a6df43733837` passed Vercel production compile and TypeScript checks and reached READY before this finalizer.
"""
checkpoint.write_text(checkpoint_text.rstrip() + "\n", encoding="utf-8")

mdm_path = Path("apps/backoffice-web/src/app/api/android-pos/mdm/heartbeat/route.ts")
mdm_text = mdm_path.read_text(encoding="utf-8-sig")
updated, count = re.subn(
    r"const MDM_RELOAD_GENERATION_MS = \d+;",
    "const MDM_RELOAD_GENERATION_MS = 1786429494893;",
    mdm_text,
    count=1,
)
if count != 1:
    raise SystemExit(f"Expected one MDM generation constant, found {count}")
mdm_path.write_text(updated.rstrip() + "\n", encoding="utf-8")

Path(".github/workflows/one-time-stock-ui-finalize.yml").unlink(missing_ok=True)
Path("scripts/one_time_stock_ui_finalize.py").unlink(missing_ok=True)
