"use client";

import { useEffect } from "react";

const WINDOWS_1252_BYTES = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f]
]);

const REPAIRABLE_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"] as const;
const SKIP_TEXT_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

function looksLikeThaiMojibake(value: string) {
  return (
    value.includes("เธ") ||
    value.includes("เน€") ||
    value.includes("โ€") ||
    value.includes("ร—") ||
    value.includes("ยท")
  );
}

function legacyByteForCodePoint(codePoint: number): number | null {
  if (codePoint <= 0x9f) return codePoint;

  // TIS-620/Windows-874 Thai block: U+0E01..U+0E5B => 0xA1..0xFB.
  if (codePoint >= 0x0e01 && codePoint <= 0x0e5b) {
    const byte = codePoint - 0x0d60;
    return byte >= 0xa1 && byte <= 0xfb ? byte : null;
  }

  return WINDOWS_1252_BYTES.get(codePoint) ?? null;
}

export function repairThaiMojibakeText(value: string): string {
  if (!value || !looksLikeThaiMojibake(value)) return value;

  const bytes: number[] = [];
  for (const character of value) {
    const byte = legacyByteForCodePoint(character.codePointAt(0) ?? -1);
    if (byte === null) return value;
    bytes.push(byte);
  }

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    if (!decoded || decoded === value || decoded.includes("�")) return value;
    return decoded;
  } catch {
    return value;
  }
}

function repairElementAttributes(element: Element) {
  for (const attribute of REPAIRABLE_ATTRIBUTES) {
    const current = element.getAttribute(attribute);
    if (!current) continue;
    const repaired = repairThaiMojibakeText(current);
    if (repaired !== current) element.setAttribute(attribute, repaired);
  }
}

function repairTextNode(node: Text) {
  const parent = node.parentElement;
  if (parent && SKIP_TEXT_TAGS.has(parent.tagName)) return;
  const current = node.nodeValue ?? "";
  const repaired = repairThaiMojibakeText(current);
  if (repaired !== current) node.nodeValue = repaired;
}

function repairNode(node: Node) {
  if (node.nodeType === Node.TEXT_NODE) {
    repairTextNode(node as Text);
    return;
  }
  if (!(node instanceof Element)) return;

  repairElementAttributes(node);
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) repairTextNode(current as Text);
    else if (current instanceof Element) repairElementAttributes(current);
    current = walker.nextNode();
  }
}

export function ThaiMojibakeRecovery() {
  useEffect(() => {
    repairNode(document.body);

    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") {
          repairNode(record.target);
          continue;
        }
        if (record.type === "attributes" && record.target instanceof Element) {
          repairElementAttributes(record.target);
          continue;
        }
        for (const addedNode of record.addedNodes) repairNode(addedNode);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...REPAIRABLE_ATTRIBUTES]
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
