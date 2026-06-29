# Design QA

## Source of truth

- Dark target: `C:\Users\Administrator\.codex\generated_images\019f10fe-b214-7730-a74b-0c098573923f\exec-d189f174-260a-4aff-ae2f-406644dd9643.png`
- Light target: `C:\Users\Administrator\.codex\generated_images\019f10fe-b214-7730-a74b-0c098573923f\exec-88a3924b-373e-44df-9253-13a02b0c1f88.png`
- Implementation captures: `qa/home-dark.png`, `qa/home-light.png`, `qa/themes-dark.png`, `qa/themes-compact.png`, `qa/settings-compact.png`
- Same-input comparisons: `qa/compare-home-dark.png`, `qa/compare-home-light.png`

## Validation

- P2 fixed: compact layouts previously left an unlabeled sound checkbox in the header. Header tools are now hidden below 860 px and remain available on Settings.
- P2 fixed: native checkboxes did not match the monochrome target. Sound and task-state controls now use accessible monochrome switches with visible focus states.
- Home composition matches the selected direction: restrained monochrome header, centered Beijing time, task table below, and separate navigation for animation effects and settings.
- Dark and light targets both retain readable contrast, hierarchy, and consistent spacing.
- Animation previews load from optimized WebP assets and retain the approved visual treatment.
- Virtual-scroll test at 800 × 600 rendered 4 initial cards and 3 different cards after scrolling, instead of keeping all 11 cards mounted.
- Runtime capture reported no JavaScript exceptions.
- Production frontend build and Rust `cargo check` both passed.

## Remaining findings

- No open P0, P1, or P2 findings.

final result: passed
