// Search keys, computed exactly as the database computes them
// (app_name_search_key and app_patient_search_keys; ADR-0020): lower-case,
// accent-free, letters and digits only. The api normalizes the typed term the
// same way, so a search needs no extra round trip. test/search-keys.test.ts
// compares the two on every run.

/** Letters that unaccent maps to more than a stripped accent. */
const SPECIAL: Record<string, string> = {
  ß: "ss",
  ẞ: "SS",
  æ: "ae",
  Æ: "AE",
  œ: "oe",
  Œ: "OE",
  ø: "o",
  Ø: "O",
  đ: "d",
  Đ: "D",
  ð: "d",
  Ð: "D",
  ł: "l",
  Ł: "L",
  þ: "th",
  Þ: "TH",
  ı: "i",
  ŀ: "l",
  Ŀ: "L",
  ĸ: "k",
  ħ: "h",
  Ħ: "H",
  ŧ: "t",
  Ŧ: "T",
  ŋ: "n",
  Ŋ: "N",
};

export function nameKey(value: string): string {
  const mapped = [...value].map((c) => SPECIAL[c] ?? c).join("");
  return mapped
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function emailKey(value: string): string {
  return value.trim().toLowerCase();
}

export function phoneKey(value: string): string {
  return value.replace(/[^0-9]+/g, "");
}

/** The smallest key after every key that starts with `prefix`, or undefined when there is none. */
export function prefixEnd(prefix: string): string | undefined {
  if (prefix === "") return undefined;
  const last = prefix.at(-1) ?? "";
  if (last === "z") return prefixEnd(prefix.slice(0, -1));
  return prefix.slice(0, -1) + (last === "9" ? "a" : String.fromCharCode(last.charCodeAt(0) + 1));
}

/** A Prisma condition: the key starts with `prefix`, as a leakproof range. */
export function prefixRange(prefix: string): { gte: string; lt?: string } {
  const end = prefixEnd(prefix);
  return end === undefined ? { gte: prefix } : { gte: prefix, lt: end };
}

/** Edit distance, for comparing names within a handful of candidates. */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j] ?? 0;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = temp;
    }
  }
  return row[b.length] ?? 0;
}

/** Similar names (ADR-0021): same key, one a prefix of the other, or close by edit distance. */
export function similarNames(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  const allowed = Math.max(1, Math.floor(Math.max(a.length, b.length) / 4));
  return editDistance(a, b) <= allowed;
}
