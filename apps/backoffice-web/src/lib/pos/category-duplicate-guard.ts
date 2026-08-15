import { normalizeCategoryKey, normalizeCategoryName } from "@/lib/pos/category-normalization";

export type SimilarCategoryMatch = {
  name: string;
  reason: "punctuation" | "edit_distance";
  distance: number;
};

function comparableCharacters(value: unknown): string[] {
  return Array.from(normalizeCategoryKey(value));
}

function compactComparable(value: unknown): string {
  return normalizeCategoryKey(value).replace(/[\p{P}\p{S}\s]+/gu, "");
}

function levenshteinDistance(left: string[], right: string[]): number {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous = current;
  }

  return previous[right.length];
}

export function findSimilarCategoryName(value: unknown, candidates: unknown[]): SimilarCategoryMatch | null {
  const normalizedValue = normalizeCategoryName(value);
  const valueKey = normalizeCategoryKey(normalizedValue);
  if (!valueKey) return null;

  const valueCharacters = comparableCharacters(normalizedValue);
  const compactValue = compactComparable(normalizedValue);
  let bestMatch: SimilarCategoryMatch | null = null;

  for (const rawCandidate of candidates) {
    const candidateName = normalizeCategoryName(rawCandidate);
    const candidateKey = normalizeCategoryKey(candidateName);
    if (!candidateKey || candidateKey === valueKey) continue;

    const compactCandidate = compactComparable(candidateName);
    if (compactValue.length >= 4 && compactValue === compactCandidate) {
      return { name: candidateName, reason: "punctuation", distance: 0 };
    }

    const candidateCharacters = comparableCharacters(candidateName);
    const maxLength = Math.max(valueCharacters.length, candidateCharacters.length);
    const threshold = maxLength >= 8 ? 2 : maxLength >= 4 ? 1 : 0;
    if (threshold === 0) continue;

    const distance = levenshteinDistance(valueCharacters, candidateCharacters);
    const distanceRatio = maxLength === 0 ? 0 : distance / maxLength;
    if (distance > threshold || distanceRatio > 0.25) continue;

    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { name: candidateName, reason: "edit_distance", distance };
    }
  }

  return bestMatch;
}
