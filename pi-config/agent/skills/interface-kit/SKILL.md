---
name: interface-kit
description: |
  Implement polished, accessible, performant UI while respecting the project's existing design
  system. Use for frontend components, landing pages, visual polish, animation, accessibility,
  responsive layout, and design implementation.
---

# Interface Kit

Build distinctive interfaces without sacrificing accessibility, performance, or project conventions.
If the project has `DESIGN.md`, tokens, component primitives, or established patterns, those are authoritative.

## Workflow

1. Inspect the existing UI, design tokens, component library, and responsive conventions.
2. State the intended result for each affected interaction, viewport, theme, loading, empty, and error state.
3. Choose one clear visual direction that fits the product; do not mix unrelated styles.
4. Implement the smallest complete vertical slice using existing primitives.
5. Verify keyboard, screen-reader, contrast, motion, layout, and performance behavior.
6. Render representative states at narrow and wide widths before calling the work complete.

## Priority order

1. **Accessibility:** semantic HTML, labels, keyboard operation, visible focus, contrast, reduced motion.
2. **Performance:** stable layout, appropriately sized assets, bounded client work, compositor-safe motion.
3. **Typography:** readable hierarchy, deliberate measure, tabular numerals for data, balanced wrapping.
4. **Layout:** consistent spacing rhythm, optical alignment, responsive behavior, complete state coverage.
5. **Color:** semantic tokens, separately tested light/dark surfaces, no component-local palette drift.
6. **Motion:** interaction feedback first; decoration only when it clarifies hierarchy or change.
7. **Polish:** shadows, texture, transitions, and micro-details after the earlier layers are sound.

## Visual direction

Choose a direction appropriate to the product: restrained editorial, refined minimal, playful, technical,
organic, retro-futuristic, or another deliberate system. Explain why it fits. Avoid generic generated-UI
defaults such as interchangeable centered heroes, gratuitous gradients, arbitrary glass panels, excessive
rounded cards, and decoration without hierarchy.

Intentionality matters more than intensity. Minimal interfaces need precise spacing and typography;
expressive interfaces need coherent rules and stronger implementation discipline.

## Layout and spacing

- Reuse the project's spacing scale; otherwise establish a compact 4/8-based rhythm.
- Align related edges and use proximity to communicate grouping before adding borders.
- Prefer grids for two-dimensional structure and flex layouts for one-dimensional distribution.
- Design mobile/narrow behavior explicitly rather than shrinking the desktop composition.
- Prevent layout shift: reserve media space, stabilize async regions, and avoid late font jumps.
- Use optical corrections when mathematically centered elements look misaligned.

## Typography

- Use the project's fonts. Do not introduce a new display face for a local component.
- Keep body copy near 45–75 characters per line; use `text-wrap: balance` or `pretty` where supported.
- Use a small, intentional type scale and distinguish hierarchy through size, weight, spacing, and color.
- Use tabular numerals for changing measurements, counters, prices, and timestamps.
- Preserve readable line height and avoid all-caps for long labels.

## Color and themes

- Reference semantic tokens such as canvas, surface, text, muted, divider, accent, warning, and error.
- Do not hardcode hex values inside components when a role exists.
- Test every changed state in each supported theme; dark mode is not an automatic inversion.
- Never rely on color alone for state or meaning.
- Target WCAG AA contrast: 4.5:1 for normal text, 3:1 for large text and essential UI boundaries.

## Interaction and motion

- Every interactive element needs hover, focus-visible, active, disabled, pending, success, and error behavior where relevant.
- Keep common feedback around 150–300 ms and animate `transform`/`opacity` when possible.
- Respect `prefers-reduced-motion`; remove nonessential motion rather than only shortening it.
- Avoid layout-property animation, surprise autoplay, and repeated motion on high-frequency actions.
- Keep touch targets at least 44×44 CSS pixels unless the project has a stricter standard.

For springs, gestures, sequencing, and interruption behavior, read
[`references/animation-playbook.md`](references/animation-playbook.md) only when the task needs advanced motion.

## Components

- Prefer native elements and project primitives over custom interaction semantics.
- Keep domain state separate from presentational variants.
- Use explicit variants instead of boolean-prop combinations that create invalid states.
- Make loading, empty, partial, overflow, long-label, error, and disabled states first-class.
- Preserve focus across async updates and return it deliberately after dialogs or transient surfaces close.

For production patterns covering dialogs, menus, forms, tables, toasts, skeletons, and command palettes, read
[`references/component-patterns.md`](references/component-patterns.md) only for the relevant component family.

## Accessibility verification

At minimum verify:

- The page uses correct landmarks, headings, labels, and native controls.
- Every action is reachable and operable by keyboard with a visible focus indicator.
- Dialog focus is trapped/restored; menus and composites use the expected arrow-key behavior.
- Validation and async status are announced without moving focus unexpectedly.
- Zoom, text resizing, reduced motion, and high-contrast preferences remain usable.
- Images have meaningful alternatives or are correctly marked decorative.

For a full audit, read [`references/accessibility-checklist.md`](references/accessibility-checklist.md).

## Performance verification

- Check responsive image sizing and modern formats.
- Avoid unnecessary client components, effects, observers, and global listeners.
- Virtualize only genuinely large collections; do not add complexity to small lists.
- Confirm no new horizontal overflow, cumulative layout shift, or long main-thread work.
- Keep animation on the compositor path and stop off-screen/repeating work.

## Completion matrix

Render and inspect representative combinations, not only the happy path:

- narrow / medium / wide
- light / dark when supported
- keyboard focus / pointer hover / active / disabled
- loading / empty / populated / overflow / error
- reduced motion
- short / long / localized labels

Use real screenshots or the live application where available. Parsing CSS and passing typechecks are supplementary checks.

For the extended final review and severity rubric, read
[`references/review-checklist.md`](references/review-checklist.md).
