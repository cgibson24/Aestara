# Aestara Design System

| | |
|---|---|
| Version | 1.0 |
| Status | Adopted with the design prototype (roadmap step 2) |
| Authority | Production Bible §24 (design system and iOS architecture), §13.2 (patient visibility), §9 (AI simulation and its disclaimer), §27 (required view states), §23 (offline). Owner decision D-05 (iOS 26 minimum, intuitive controls). ADR-0009 (static prototype), ADR-0011 (one token source). |
| Tokens | `packages/design-tokens/tokens.json` (compiled to CSS, TypeScript and Swift) |
| Reference implementation | `apps/design-prototype` (web mock-up of the core scenes, hard-coded data) |

This document says how Aestara looks and, more importantly, how its controls behave. Every screen built in Layers 1–10 follows it. The Bible wins where the two disagree; raise the conflict rather than picking one.

---

## 1. Principles

The Bible's principles (§24.1), with what each one means in practice:

| Principle | In practice |
|---|---|
| Original premium clinical aesthetic | Quiet neutrals, one deep-teal accent, no decorative gradients or illustrations on clinical screens. Nothing borrowed from any vendor's trade dress (constitution §30). |
| Photography-forward | Clinical photos sit on a neutral studio-grey stage (`photoStage`) so skin tones read accurately. Chrome gets out of the way of the image. |
| Clean and restrained | One primary action per screen. Cards only where grouping helps. Badges carry status, not decoration. |
| High information clarity | Identify the patient (name, DOB, MRN) on every patient screen. Show state in words ("Draft, saved on device"), not just colour. |
| iPad landscape first, iPhone supported | Design at 1180 × 820 first, then prove the same scene works at 393 × 852 (§4). |
| Accessible by default | 44 pt targets, Dynamic Type, VoiceOver labels, WCAG AA contrast enforced in CI (§5). |
| Consistent states | Every data-backed view has loading, empty, error, permission-denied and offline variants (§6). |

---

## 2. Intuitive controls: the rules

The owner's requirement is that the iPhone and iPad controls are intuitive. These rules make that testable. A screen that breaks one needs a written reason in its feature prompt.

### Targets and placement

- **C1: 44 pt minimum.** Every tappable element is at least 44 × 44 pt (`size.touchTarget`). Primary buttons on iPhone are 52 pt tall (`size.controlHeightLarge`).
- **C2: One primary action per screen.** Only one filled accent button is visible at a time. On iPad it sits at the trailing end of the navigation bar or decision bar. On iPhone it sits full-width at the bottom, within thumb reach.
- **C3: Things stay where they are.** Back is always top-leading. Screen actions are top-trailing. The camera shutter never moves. Tab order never changes between screens.
- **C4: Destructive is never primary.** Reject, Disable, Void and Withdraw use the destructive style and are never the default button of a sheet.

### Labels and meaning

- **C5: Verb + object.** Buttons say what happens: "Capture left profile", "Release to Ana's app", "Choose Plan B". Never "OK", "Submit" or "Next" alone.
- **C6: Icons need words.** Icon-only buttons are allowed only in navigation bars and toolbars, and only with a common meaning (close, back, send, add, share). Each one has an accessibility label. On iPhone the navigation-bar labels collapse to icons, but the text stays available to VoiceOver.
- **C7: Controls match the choice.**
  - Segmented control: 2–5 mutually exclusive views of the same thing.
  - Toggle: an immediate on/off setting.
  - Radio cards: choosing one option that has details (treatment plans).
  - Menu: more than five options.

### Gestures and feedback

- **C8: No hidden gestures for anything important.** Swipe, long-press and pinch are shortcuts only. Every one has a visible button that does the same thing.
- **C9: Disabled controls explain themselves.** A disabled button always has a nearby reason: the offline banner, "1 required view left", or a permission note. It is never silently grey.
- **C10: Show progress and saving.** Multi-step work shows its steps (the consultation stepper). Drafts say where they are saved ("Draft, saved on device"). Background work is visible (§23, §22.4: no hidden background work).

### Consequences

- **C11: Confirm outward-facing and irreversible actions with a sheet.** This covers release to patient, send plan, sign, void, disable user and export.
  - The sheet states who will see what, in plain words, and whether it can be undone.
  - The confirm button repeats the verb ("Release", not "Yes").
- **C12: Separate steps stay separate.** Approving an AI visualization shares nothing. Releasing it is a second, explicit act with its own confirmation (Bible §9).
  - The same applies to choosing a plan versus consenting to treatment, and to capturing a photo versus exporting it.
  - The UI says so where people might assume otherwise.
- **C13: Device handoff is locked.** Patient signing mode shows a persistent banner. Leaving it requires staff Face ID, and the patient cannot navigate elsewhere.

### Capture

- **C14: Guidance in words, not only numbers.** Live capture shows one plain instruction ("Raise chin slightly"), a framing oval sized to the face, an optional ghost overlay of the previous photo, and quality chips (lighting, distance, pose).
  - Scores are labelled as photographic match, never as a medical measurement.

### Forms

- **C15: Forms are forgiving.**
  - Labels sit above fields; placeholders are never the only label.
  - Keyboard types match the field.
  - Errors appear inline next to the field and say how to fix it.
  - Nothing typed is lost on error or when going offline.

---

## 3. Safety copy that is part of the design

These strings and treatments are not optional styling. The prototype's tests check them.

| Where | Requirement |
|---|---|
| Any AI image | An "AI visualization" tag on the image itself, using the `simulation` colour role (violet), never the accent. |
| AI image shown to a patient | The disclaimer, verbatim: "AI-generated visualization for consultation purposes. Actual clinical outcomes vary. This visualization is not a guarantee or prediction of medical results." It appears above the image and is not collapsible. |
| AI parameter controls | Visual terms only (volume, definition, projection) with a note that the model has no dose, product, unit, depth or technique settings. No control is labelled with units, syringes or dosage. |
| Plans shown to patients | "This is an estimate, not a bill. Choosing a plan is not consent to treatment." |
| Photo scores | "Photographic position match, not a medical measurement." |
| Anywhere | No guarantee language ("guaranteed", "will look", "results in"). Patient-facing text aims at about an 8th-grade reading level. |

---

## 4. Adaptive layout (iPad and iPhone)

One scene definition serves both devices. It adapts on horizontal size class, the way SwiftUI's `NavigationSplitView` does. The prototype does the same with a CSS container query on the device screen (`@container screen (max-width: 700px)` means compact).

| Element | iPad (regular) | iPhone (compact) |
|---|---|---|
| Navigation | Sidebar, 264 pt (`size.sidebarWidth`): Patients, Schedule, Consultations, Messages, Capture, Settings. Practice switcher at the top. | Tab bar, 49 pt (`size.tabBarHeight`): Patients, Schedule, Capture, Messages, More. |
| Lists | List pane, 340 pt (`size.listPaneWidth`), plus the selected record's detail beside it. | List only. Tapping a row pushes the detail. |
| Titles | Inline title in the navigation bar. | Large title (34 pt) that scrolls under the bar. |
| Screen actions | Labelled buttons, top-trailing. | Icon buttons, top-trailing, with labels kept for VoiceOver. |
| Multi-column content (consultation, visualization, plans) | Two or three columns. | One column, in reading order. The consultation stepper becomes a horizontal strip. |
| Plan comparison | Plans side by side, one selected. | A segmented control picks one plan; one plan is shown at a time. |
| Sheets | Centred form sheet. | Bottom sheet, full width. |
| Camera | Full screen with controls on a bottom bar; quality chips at the trailing end. | Full screen; the protocol strip scrolls, keeping the current view centred. Quality chips are hidden and the guidance line stays. |

Deep links always open the destination through the normal authorization path and never trust cached UI state (§24.5).

---

## 5. Accessibility

| Area | Rule |
|---|---|
| Contrast | Text ≥ 4.5:1 and UI components ≥ 3:1 in both themes. Enforced by `pnpm --filter @aestara/design-tokens test` (63 checks) over every text/background and control/background pair in `tokens.json`. |
| Dynamic Type | Type tokens map one-to-one onto iOS text styles (`largeTitle` … `caption2`). The iOS apps use the text styles, not fixed sizes, and layouts must survive accessibility sizes (rows grow and text wraps; nothing truncates a patient name). |
| VoiceOver | Every control has a label. Decorative icons are hidden. Photos are described by view ("Clinical photo, left profile"). Status and progress are announced (`role="status"` or the SwiftUI equivalent). |
| Colour | Never the only signal. Badges pair colour with a word and often an icon (✓ 95%, "Required", "Declined"). |
| Motion | 120–320 ms, standard easing. Everything honours Reduce Motion. |
| Focus | A visible 3 px focus ring (`focusRing`) for keyboard users on iPad and the admin web. |
| Native semantics first | Use native controls (radio inputs for segmented controls, links for list rows that navigate, `<button>` for actions) before ARIA roles. The prototype's lint gate (Biome a11y rules) enforces this. |

---

## 6. View states

Every view that loads data implements all six states. The prototype's viewer can switch any scene into each one, and the tests render every scene in every state.

| State | Shows | Copy pattern |
|---|---|---|
| Normal | The content | — |
| Loading | A skeleton shaped like the content, never a lone spinner on a blank page | (none visible; VoiceOver hears "Loading") |
| Empty | Icon, title, one sentence, at most one action | "No patients yet". "Add your first patient to start a consultation." [New patient] |
| Error | Icon, what happened, reassurance, retry | "Couldn't load this". "The connection to the server dropped. Nothing you entered was lost." [Try again] |
| Permission denied | Lock icon, what is restricted, who to ask. Never reveals whether the record exists. | "You don't have access". "Your role doesn't include treatment plans. Ask a practice administrator if you need it." |
| Offline | A banner above normal content, with online-only actions disabled | "You're offline". "Photos and notes are saved on this device and sync when you reconnect. AI visualizations, sending and releasing need a connection." |

What works offline follows Bible §23.1 and §23.2 exactly. Capture, drafting and annotating work offline. AI generation, sending, releasing and EMR sync do not.

---

## 7. Tokens

`tokens.json` is the only place a colour, size or duration is defined. `pnpm tokens` compiles it to:

- `generated/tokens.css`: CSS custom properties, light and dark
- `generated/tokens.ts`
- `generated/DesignTokens.swift`: `DSColor`, `DSFont`, `DSSpacing`, `DSRadius`, `DSSize`, `DSMotion`

CI fails if the generated files drift from the source.

### Colour roles

Every role has a light and a dark value. Use the role that matches the meaning, never a raw value.

| Role | Use |
|---|---|
| `canvas`, `surface`, `surfaceRaised`, `surfaceSunken` | Page background, cards, sheets, and wells (search fields, segmented tracks) |
| `border`, `controlBorder` | Hairline separators; the outlines of inputs and secondary buttons (≥ 3:1) |
| `textPrimary`, `textSecondary`, `textTertiary`, `textOnAccent` | Text hierarchy. Tertiary is for metadata only, never for anything actionable. |
| `accent`, `accentPressed`, `accentSoft`, `accentText` | Primary actions, selection, links. Deep teal. |
| `success`, `warning`, `danger`, `info` (+ `Soft`) | Status badges and banners. `danger` is also used for destructive actions. |
| `simulation`, `simulationSoft` | AI-generated content only, so it can never be confused with a real photo |
| `photoStage`, `photoStageText` | The neutral backdrop behind clinical images and the camera, and the text on it |
| `focusRing`, `highlight`, `scrim` | Keyboard focus, search-match highlight, the dimming behind sheets |

### Type

The scale mirrors iOS Dynamic Type at the default (Large) size:

| Style | Size / line height | Weight |
|---|---|---|
| largeTitle | 34 / 41 | 700 |
| title1 | 28 / 34 | 700 |
| title2 | 22 / 28 | 600 |
| title3 | 20 / 25 | 600 |
| headline | 17 / 22 | 600 |
| body | 17 / 22 | 400 |
| callout | 16 / 21 | 400 |
| subheadline | 15 / 20 | 400 |
| footnote | 13 / 18 | 400 |
| caption1 | 12 / 16 | 400 |
| caption2 | 11 / 13 | 500 |

The system font (SF Pro) is used on Apple platforms, and Inter elsewhere. Numbers in tables, prices and times use tabular figures.

### Space, shape, size, elevation, motion

| Group | Values |
|---|---|
| Spacing | 2, 4, 8, 12, 16, 20, 24, 32, 40, 48 (`xxs` … `page`) |
| Radius | 6, 10, 14, 20, pill |
| Size | touch target 44, control 44 / 52, icons 16 / 20 / 24, sidebar 264, list pane 340, tab bar 49 |
| Elevation | `card` (resting), `raised` (drawers, active cards), `overlay` (sheets, popovers) |
| Motion | 120 / 200 / 320 ms, `cubic-bezier(0.2, 0, 0, 1)` |

---

## 8. Components

These are the components the Bible requires (§24.2). The prototype builds each once in `src/ui/kit.tsx` and `src/ui/shells.tsx`, and the iOS `DesignSystem` module (§24.4) mirrors the same set.

| Bible component | Prototype | SwiftUI counterpart | Notes |
|---|---|---|---|
| Typography | `.text-*` classes | `DSFont` + text styles | |
| Spacing tokens | `var(--space-*)` | `DSSpacing` | |
| Buttons | `Button`, `IconButton` | `DSButton` (primary, secondary, tertiary, destructive) | See C2, C4, C5, C6 |
| Cards | `Card` | `DSCard` | Title plus an optional trailing action |
| Forms | sign-in and composer fields | `Form` / `TextField` with `DSField` label | See C15 |
| Search | `SearchField` | `.searchable` | Placeholder names what can be searched |
| Tables / lists | `ListRow`, `.table` | `List`, `Table` (iPad) | Rows are navigation links with a chevron |
| Navigation | `ProviderShell`, `PatientShell`, `AdminShell`, `TabBar` | `NavigationSplitView`, `TabView` | See §4 |
| Image viewer | `Portrait` on `photoStage` | `DSPhotoView` | Neutral backdrop, view name caption |
| Photo capture overlays | Capture scene | `CaptureOverlay` | See C14 |
| Before / after viewer | Compare scene | `BeforeAfterView` | Side by side, slider, cross-fade, blink, overlay; alignment is display-only |
| Simulation viewer | Visualization scene | `SimulationView` | AI tag, compare toggle, visual parameters |
| Modals | Release sheet | `.sheet` | See C11 |
| Alerts | `Banner` | `DSBanner` | For system status, not errors in forms |
| Status badges | `Badge` | `DSBadge` | Word plus colour plus optional icon |
| Empty / error / loading states | `StateView`, `Skeleton` | `DSStateView` | See §6 |

Additional controls in the prototype: `Segmented` (native radio inputs), `Toggle` (switch role), `Meter` (labelled value, visual only) and `Avatar` (initials, decorative).

---

## 9. Voice and formatting

- Plain words, sentence case, US English. Address staff by role and patients by first name ("Good morning, Ana").
- Dates: "Wed, Oct 14 · 10:30 AM". Times are shown in the practice's time zone and labelled where ambiguous (the audit log says "Time (ET)").
- Money: USD, "$1,450". Estimates are always labelled as estimates.
- Identifiers: MRN is shown as "MRN A-000142". Audit and admin screens show identifiers, never clinical content.
- Errors say what happened and what to do, and never blame the user.

---

## 10. The design prototype

`apps/design-prototype` is a static, hard-coded mock-up of the core scenes (ADR-0009). It has no backend, no authentication and no real patient data (every person is fictional). It is never deployed as the product.

```bash
pnpm dev:prototype                                      # http://localhost:5173
pnpm --filter @aestara/design-prototype test            # every scene × every state, plus safety-copy checks
pnpm --filter @aestara/design-prototype build           # also writes dist-artifact/aestara-design-prototype.html
```

| Surface | Frame | Scenes |
|---|---|---|
| Provider iPad | 1180 × 820 | Sign in, Patients, Patient record, Consultation, Capture, Before/after, AI visualization, Release sheet, Treatment plans, Consent (signing mode), Messages |
| Provider iPhone | 393 × 852 | The same scenes, adapted (§4) |
| Patient iPhone | 393 × 852 | Home, Your visualization, Treatment options, Care team messages |
| Admin web | 1280 × 820 | Users & roles, Audit log |

The viewer switches surface, scene, view state (§6) and theme (light, dark, or follow the system). Deep links use the form `#<surface>-<scene>`, for example `#iphone-capture` or `#patient-plan`.

---

## 11. Checklist for every feature's UI

Copy this into each feature prompt (Bible §33) that touches a screen:

- [ ] Works at iPad landscape and iPhone portrait; nothing clips at the largest accessibility text size.
- [ ] Exactly one primary action; destructive actions are not primary.
- [ ] Every control is at least 44 pt, has a verb + object label or an accessibility label, and has no gesture-only path.
- [ ] Irreversible or outward-facing actions confirm with a sheet that names who sees what.
- [ ] All six view states are implemented and reachable in previews.
- [ ] Offline behaviour matches §23; disabled controls explain why.
- [ ] Only token values are used; contrast tests pass in both themes.
- [ ] Safety copy from §3 is present where it applies, and there is no guarantee language.
- [ ] No PHI in logs, analytics events or URLs.
