#!/usr/bin/env node
// Compiles tokens.json into generated/tokens.css, generated/tokens.ts and
// generated/DesignTokens.swift (plus the iOS DesignSystem module's copy). Generated files are committed so the iOS apps
// can consume them without Node; CI fails if they drift from tokens.json.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = JSON.parse(readFileSync(join(root, "tokens.json"), "utf8"));
const outDir = join(root, "generated");
mkdirSync(outDir, { recursive: true });

const HEADER = "Generated from packages/design-tokens/tokens.json by scripts/build.mjs. Do not edit.";
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

const lightKeys = Object.keys(tokens.color.light);
const darkKeys = Object.keys(tokens.color.dark);
if (lightKeys.join() !== darkKeys.join()) {
  throw new Error("color.light and color.dark must define the same roles in the same order");
}

// ---------------------------------------------------------------- CSS
const cssColor = (hex) => {
  if (hex.length === 9) {
    const a = Number.parseInt(hex.slice(7, 9), 16) / 255;
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
  }
  return hex;
};
const colorVars = (theme) =>
  Object.entries(tokens.color[theme])
    .map(([k, v]) => `  --color-${kebab(k)}: ${cssColor(v)};`)
    .join("\n");

const scalarVars = [
  ...Object.entries(tokens.space).map(([k, v]) => `  --space-${k}: ${v}px;`),
  ...Object.entries(tokens.radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
  ...Object.entries(tokens.size).map(([k, v]) => `  --size-${kebab(k)}: ${v}px;`),
  ...Object.entries(tokens.elevation).map(([k, v]) => `  --elevation-${k}: ${v};`),
  ...Object.entries(tokens.motion).map(([k, v]) =>
    k === "easing" ? `  --motion-easing: ${v};` : `  --motion-${k}: ${v}ms;`,
  ),
  ...Object.entries(tokens.typography.fontFamily).map(([k, v]) => `  --font-${k}: ${v};`),
  ...Object.entries(tokens.typography.styles).flatMap(([k, s]) => [
    `  --text-${kebab(k)}-size: ${s.size}px;`,
    `  --text-${kebab(k)}-line: ${s.lineHeight}px;`,
    `  --text-${kebab(k)}-weight: ${s.weight};`,
  ]),
].join("\n");

const textClasses = Object.entries(tokens.typography.styles)
  .map(
    ([k]) =>
      `.text-${kebab(k)} {\n  font-size: var(--text-${kebab(k)}-size);\n  line-height: var(--text-${kebab(k)}-line);\n  font-weight: var(--text-${kebab(k)}-weight);\n}`,
  )
  .join("\n");

const css = `/* ${HEADER} */
:root {
  color-scheme: light dark;
${colorVars("light")}
${scalarVars}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${colorVars("dark").replace(/^ {2}/gm, "    ")}
  }
}

:root[data-theme="dark"] {
${colorVars("dark")}
}

:root[data-theme="light"] {
${colorVars("light")}
}

${textClasses}
`;
writeFileSync(join(outDir, "tokens.css"), css);

// ---------------------------------------------------------------- TypeScript
const ts = `// ${HEADER}
export const tokens = ${JSON.stringify(
  {
    color: tokens.color,
    typography: tokens.typography,
    space: tokens.space,
    radius: tokens.radius,
    size: tokens.size,
    elevation: tokens.elevation,
    motion: tokens.motion,
  },
  null,
  2,
)} as const;

export type ColorRole = keyof typeof tokens.color.light;
export type TextStyle = keyof typeof tokens.typography.styles;
export type Space = keyof typeof tokens.space;
`;
writeFileSync(join(outDir, "tokens.ts"), ts);

// ---------------------------------------------------------------- Swift
const hexToSwift = (hex) => `0x${hex.slice(1).toUpperCase().padEnd(8, "F")}`;
const swiftColors = lightKeys
  .map(
    (k) =>
      `    public static let ${k} = Color(light: ${hexToSwift(tokens.color.light[k])}, dark: ${hexToSwift(tokens.color.dark[k])})`,
  )
  .join("\n");
const swiftScalars = (name, obj) =>
  `public enum ${name} {\n${Object.entries(obj)
    .map(([k, v]) => `    public static let ${k}: CGFloat = ${v}`)
    .join("\n")}\n}`;
const swiftFonts = Object.entries(tokens.typography.styles)
  .map(([k, s]) => {
    const weight =
      s.weight >= 700 ? ".bold" : s.weight >= 600 ? ".semibold" : s.weight >= 500 ? ".medium" : ".regular";
    return `    public static let ${k} = Font.system(.${s.ios}).weight(${weight})`;
  })
  .join("\n");

const swift = `// ${HEADER}
// Colours adapt to light/dark mode; fonts are system text styles so they scale with Dynamic Type.
import SwiftUI
import UIKit

public enum DSColor {
${swiftColors}
}

${swiftScalars("DSSpacing", tokens.space)}

${swiftScalars("DSRadius", tokens.radius)}

${swiftScalars("DSSize", tokens.size)}

public enum DSFont {
${swiftFonts}
}

public enum DSMotion {
    public static let fast: Double = ${tokens.motion.fast / 1000}
    public static let standard: Double = ${tokens.motion.standard / 1000}
    public static let slow: Double = ${tokens.motion.slow / 1000}
}

extension Color {
    /// Dynamic colour from 0xRRGGBBAA values for light and dark appearance.
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(rgba: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(rgba: UInt32) {
        self.init(
            red: CGFloat((rgba >> 24) & 0xFF) / 255,
            green: CGFloat((rgba >> 16) & 0xFF) / 255,
            blue: CGFloat((rgba >> 8) & 0xFF) / 255,
            alpha: CGFloat(rgba & 0xFF) / 255
        )
    }
}
`;
writeFileSync(join(outDir, "DesignTokens.swift"), swift);
// The iOS DesignSystem module compiles its own copy (Swift packages cannot
// reach outside their directory); CI fails if the two drift.
const iosDesignSystem = join(root, "../../apps/ios-provider/Modules/DesignSystem/Sources/DesignSystem");
mkdirSync(iosDesignSystem, { recursive: true });
writeFileSync(join(iosDesignSystem, "DesignTokens.swift"), swift);

console.log(
  `design-tokens: wrote tokens.css, tokens.ts, DesignTokens.swift (${lightKeys.length} colour roles)`,
);
