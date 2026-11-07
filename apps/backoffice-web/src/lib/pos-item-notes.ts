const ITEM_DETAIL_MARKER = "[[CPIPOS_ITEM_DETAIL]]:";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function encodeDetail(value: string): string {
  return encodeURIComponent(value);
}

function decodeDetail(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export type ParsedPosItemNotes = {
  optionNotes: string;
  detailNote: string;
};

/**
 * Keeps recipe/modifier selections backward-compatible in order_items.notes while
 * storing a separate cashier-entered free-text detail in a machine-readable line.
 * Older notes without the marker remain valid option notes.
 */
export function parsePosItemNotes(value: unknown): ParsedPosItemNotes {
  const raw = clean(value);
  if (!raw) return { optionNotes: "", detailNote: "" };

  const optionLines: string[] = [];
  const detailLines: string[] = [];
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith(ITEM_DETAIL_MARKER)) {
      const encoded = trimmed.slice(ITEM_DETAIL_MARKER.length);
      const decoded = clean(decodeDetail(encoded));
      if (decoded) detailLines.push(decoded);
      continue;
    }
    optionLines.push(trimmed);
  }

  return {
    optionNotes: optionLines.join(", "),
    detailNote: detailLines.join("\n")
  };
}

export function composePosItemNotes(optionNotes: unknown, detailNote: unknown): string | null {
  const options = clean(optionNotes);
  const detail = clean(detailNote).slice(0, 500);
  const parts: string[] = [];
  if (options) parts.push(options);
  if (detail) parts.push(`${ITEM_DETAIL_MARKER}${encodeDetail(detail)}`);
  return parts.length > 0 ? parts.join("\n") : null;
}

export function splitPosItemOptionNotes(value: unknown): string[] {
  const { optionNotes } = parsePosItemNotes(value);
  return optionNotes
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function formatPosItemNotesForDisplay(
  value: unknown,
  detailLabel = "รายละเอียด"
): string {
  const parsed = parsePosItemNotes(value);
  const lines: string[] = [];
  if (parsed.optionNotes) lines.push(parsed.optionNotes);
  if (parsed.detailNote) lines.push(`${detailLabel}: ${parsed.detailNote}`);
  return lines.join("\n");
}
