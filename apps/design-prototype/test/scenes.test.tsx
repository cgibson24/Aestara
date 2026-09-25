// Renders every scene in every view state (catches runtime errors) and checks
// the Bible's patient-safety copy rules against the rendered markup.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { disclaimer } from "../src/data/fixtures";
import { type SurfaceKey, surfaces } from "../src/prototype/Prototype";
import { type ViewState, ViewStateContext } from "../src/ui/kit";

const states: ViewState[] = ["normal", "loading", "empty", "error", "offline", "denied"];

const render = (surface: SurfaceKey, scene: string, state: ViewState = "normal") => {
  const def = surfaces[surface].scenes.find((s) => s.key === scene);
  if (!def) throw new Error(`unknown scene ${surface}/${scene}`);
  return renderToStaticMarkup(
    <ViewStateContext.Provider value={state}>{def.render()}</ViewStateContext.Provider>,
  );
};

describe("every scene renders in every view state", () => {
  for (const surface of Object.keys(surfaces) as SurfaceKey[]) {
    for (const scene of surfaces[surface].scenes) {
      it.each(states)(`${surface}/${scene.key} (%s)`, (state) => {
        expect(render(surface, scene.key, state).length).toBeGreaterThan(100);
      });
    }
  }
});

describe("Bible patient-safety copy", () => {
  it("patient visualization shows the §9.1 disclaimer verbatim", () => {
    expect(render("patient", "visualization")).toContain(disclaimer);
  });

  it("release confirmation shows the disclaimer the patient will see", () => {
    expect(render("ipad", "release")).toContain(disclaimer);
  });

  it("no scene promises a guaranteed or predicted outcome", () => {
    for (const surface of Object.keys(surfaces) as SurfaceKey[]) {
      for (const scene of surfaces[surface].scenes) {
        const text = render(surface, scene.key)
          .replace(/<[^>]+>/g, " ")
          .replace(disclaimer, "")
          .toLowerCase();
        expect(text, `${surface}/${scene.key}`).not.toMatch(
          /\bguaranteed? (result|outcome)|your (predicted|future) (result|look)/,
        );
      }
    }
  });

  it("AI visualization offers no dosage, product, units or technique controls", () => {
    const html = render("ipad", "visualization");
    const controls = [...html.matchAll(/class="meter-head"><span>([^<]+)<\/span>/g)].map((m) => m[1] ?? "");
    expect(controls.length).toBeGreaterThan(0);
    for (const label of controls) {
      expect(label.toLowerCase()).not.toMatch(
        /\b(ml|units?|doses?|dosage|syringes?|needle|depth|cannula|product|brand)\b/,
      );
    }
  });

  it("approving is separate from releasing", () => {
    const review = render("ipad", "visualization");
    expect(review).toContain("Approving doesn&#x27;t share anything with the patient.");
    expect(review).not.toContain("Release to Ana");
  });
});
