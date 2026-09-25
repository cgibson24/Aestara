// Accessibility gate for the palette (Bible 24.1 "Accessible by default"):
// WCAG 2.2 contrast of at least 4.5:1 for text pairs and 3:1 for non-text UI
// (control borders, focus rings, icons), in both light and dark themes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Theme = "light" | "dark";
type Tokens = {
  color: Record<Theme, Record<string, string>>;
  contrast: { text: [string, string][]; nonText: [string, string][] };
};

const tokens: Tokens = JSON.parse(readFileSync(join(import.meta.dirname, "..", "tokens.json"), "utf8"));

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
};
const contrastRatio = (fg: string, bg: string) => {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
};

describe.each<Theme>(["light", "dark"])("%s theme", (theme) => {
  const palette = tokens.color[theme];

  it.each(tokens.contrast.text)("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(palette[fg], `missing role ${fg}`).toBeDefined();
    expect(palette[bg], `missing role ${bg}`).toBeDefined();
    expect(contrastRatio(palette[fg] as string, palette[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(tokens.contrast.nonText)("UI %s on %s is at least 3:1", (fg, bg) => {
    expect(contrastRatio(palette[fg] as string, palette[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});

describe("token structure", () => {
  it("defines the same colour roles for light and dark", () => {
    expect(Object.keys(tokens.color.dark)).toEqual(Object.keys(tokens.color.light));
  });
});
