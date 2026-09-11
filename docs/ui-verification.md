# UI verification

Gateship's browser contract uses the development harness at
`webui/harness.html`. It supplies deterministic fixtures without a live
backend, including a fixed clock, locale, theme, motion setting, viewport and
Chromium project. The product image does not contain browser tooling.

Run the focused checks with:

```sh
bun run test:ui:smoke:fixed
bun run test:ui:visual:fixed
```

The commands write Playwright's HTML report, JSON result and failure evidence
under `test-results/ui/`. Smoke assertions protect navigation, focus, menus,
sorting, pagination, internal table scrolling and layout overflow. Visual
snapshots cover the four Central screens at 390px and 1440px in light/dark
themes and PT/EN locales. The 768px viewport remains in smoke coverage.

Snapshots are evidence of objective rendering invariants, not a beauty score.
They do not prohibit a new composition: an intentional visual change updates
the relevant baseline only after the corrected screen is reviewed, with the
reason and the expected/actual/diff evidence kept in the pull request. Do not
use broad tolerances, masks that hide defects or blind baseline updates.
