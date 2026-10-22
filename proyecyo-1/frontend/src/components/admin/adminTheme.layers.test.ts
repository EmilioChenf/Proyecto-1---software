import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// HU-C02 (C02.1): causa del sidebar duplicado. El CSS SIN capa gana a cualquier capa de
// Tailwind v4, asi que una clase del tema con "display" anulaba utilidades como
// "hidden lg:flex" y el boton de contraer aparecia tambien en movil/zoom, junto al de menu.
// jsdom no aplica la cascada de capas, por eso esta prueba verifica la regla estructural:
// toda clase del tema que se combine con una utilidad responsive de visibilidad debe
// definir su "display" dentro de una capa (@layer components).

const ROOT = path.resolve(__dirname, "../../..");
const THEME = path.resolve(__dirname, "adminTheme.css");
const css = readFileSync(THEME, "utf8");

function stripLayerBlocks(source: string) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const start = source.indexOf("@layer", index);
    if (start === -1) { output += source.slice(index); break; }
    const brace = source.indexOf("{", start);
    const semicolon = source.indexOf(";", start);
    output += source.slice(index, start);
    if (brace === -1 || (semicolon !== -1 && semicolon < brace)) { index = semicolon + 1; continue; } // declaracion de orden
    let depth = 0;
    let cursor = brace;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === "{") depth++;
      else if (source[cursor] === "}" && --depth === 0) break;
    }
    index = cursor + 1;
  }
  return output;
}

/** Clases .nd-* que fijan display en reglas sin capa (selector simple .nd-x{...}). */
function unlayeredDisplayClasses(source: string) {
  const found = new Set<string>();
  const ruleRe = /(^|[}\s])\.(nd-[a-z-]+)\s*\{([^}]*)\}/g;
  for (const match of stripLayerBlocks(source).matchAll(ruleRe)) {
    if (/(^|;)\s*display\s*:/.test(match[3])) found.add(match[2]);
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

const RESPONSIVE_VISIBILITY = /^(?:[a-z0-9]+:)+(?:hidden|block|flex|inline-flex|grid|inline-block)$|^hidden$/;

/** Pares (clase del tema, utilidad de visibilidad) usados en el mismo className. */
function themeClassesWithResponsiveVisibility() {
  const pairs: Array<{ file: string; themeClass: string; utility: string }> = [];
  for (const file of sourceFiles(path.join(ROOT, "src"))) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.includes("className")) continue;
      const tokens = [...line.matchAll(/["'`]([^"'`]*)["'`]/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
      const themeClasses = tokens.filter((token) => /^nd-[a-z-]+$/.test(token));
      const utilities = tokens.filter((token) => RESPONSIVE_VISIBILITY.test(token));
      for (const themeClass of themeClasses) for (const utility of utilities) pairs.push({ file: path.relative(ROOT, file), themeClass, utility });
    }
  }
  return pairs;
}

describe("HU-C02 cascada del tema frente a utilidades responsive", () => {
  it("declara el mismo orden de capas que Tailwind antes de cualquier regla", () => {
    expect(css.trimStart().replace(/\/\*[\s\S]*?\*\//g, "").trimStart().startsWith("@layer theme, base, components, utilities;")).toBe(true);
  });

  it("detecta los usos reales (la regla no pasa por vacio)", () => {
    const used = new Set(themeClassesWithResponsiveVisibility().map((pair) => pair.themeClass));
    expect(used.has("nd-collapse")).toBe(true);
    expect(used.has("nd-badge")).toBe(true);
  });

  it("ninguna clase del tema combinada con visibilidad responsive fija display sin capa", () => {
    const unlayered = unlayeredDisplayClasses(css);
    const conflicts = themeClassesWithResponsiveVisibility().filter((pair) => unlayered.has(pair.themeClass));
    expect(conflicts).toEqual([]);
  });

  it("el analizador identifica una definicion sin capa (control negativo)", () => {
    expect(unlayeredDisplayClasses(".nd-collapse{display:flex}")).toEqual(new Set(["nd-collapse"]));
    expect(unlayeredDisplayClasses("@layer components{.nd-collapse{display:flex}}")).toEqual(new Set());
  });
});
