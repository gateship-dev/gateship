# Gateship design system

The interface is quiet while work is autonomous and becomes visually explicit
only when the operator must act. This file is the single design contract for
the web UI.

A rule exists to make sure the system is used, not to forbid a choice. Each rule
below names the check that enforces it. A rule with no check is judgment, and
says so. A deliberate departure is allowed when it is written down with its
reason where the check reads it; a departure nobody wrote down is an accident,
and a written one that nothing uses any more is stale. Both fail.

## How the contract is checked

| Check | Command | What it reads |
| --- | --- | --- |
| Contract test | `bun test test/web/design-contract.test.ts` | Class names in the product source: spacing grid, type scale, weights |
| Design lint | `bun run lint:design` | `@shadcn/lint` over `webui/src`. Findings are errors under `webui/src/screens` and a report in the kit |
| Visual gate | `bun scripts/ui-test.ts visual` | The rendered page in a fixed container: measurements first, then pixel baselines |
| Behaviour tests | `bun test test/web` | Static markup of every surface in both locales |

`bun run check:all` runs the first, second and fourth. The visual gate runs in
CI and locally through Docker (`linux/amd64`), because baselines only compare
inside one rendering environment. `bun scripts/ui-test.ts update` regenerates
them, and a regenerated baseline is looked at before it is committed.

Every new check ships with a planted case that proves it fails. Two gates in
this repository once passed while measuring nothing: baselines of unstyled HTML,
and a contrast check that could not parse the colour space the browser returned.

The design scratchpad (`webui/design.html`, served by Vite) shows the same
numbers live: type scale, token ladder, spacing in use, each component's
variants read from its source, the screens with their measurements, and an
inspector that copies `slot[variant,size] WxH` for talking about one element.

## Foundations

| Rule | Check |
| --- | --- |
| Spacing sits on the 4px grid. A departure is listed with its reason in `webui/src/design/exceptions.ts` | Contract test, both directions |
| Type uses the scale in `webui/src/index.css` (`xs` 11px to `2xl` 28px). No arbitrary size | Contract test |
| Weights are normal, medium and semibold. `bold` and the unused weights are switched off in the theme with `initial` | Contract test |
| An option nothing uses is removed from the theme, not kept for later | Scratchpad "Used only" view, judgment |
| A screen needs at most 6 font sizes and 12 text colours | Visual gate |
| Text meets WCAG AA: 4.5:1, or 3:1 from 24px (18.66px when semibold) | Visual gate |
| Nothing spills out of its box by more than 8px where it can be seen. A scroll container and a deliberate clip are not spills | Visual gate |
| The page never scrolls horizontally | Visual gate |
| Colours come from tokens. No raw colour, no arbitrary value, no inline style, no class Tailwind does not know | Design lint |
| Sans is the voice of titles, navigation, labels, table heads and prose. Mono is the voice of identifiers, commands, timestamps, durations, costs and counters | Kit defaults (`TableHead` is always sans, `type-data`, `type-eyebrow`), judgment at the call site |
| Saans is not bundled. The interface uses the system sans until a repository asset and its licence are added | Judgment |
| Acid (`#c8ff00`) marks one thing: work waiting on the operator. It appears as the attention tone of `Stat`, the rule on the leading edge of a row or queue (`--shadow-attention-rule`), and the attention badge. Counters, links and healthy activity stay grey | Behaviour tests, judgment |
| State is never colour alone. It comes with text, shape or position | Judgment |
| Every surface is judged in both themes before it is accepted | Visual gate baselines, judgment |

A value the lint would refuse and the design needs (a width that depends on the
viewport, a runtime anchor width, an asset's own proportions) stays, with an
`oxlint-disable-next-line <rule> -- <reason>` on the line above it. The lint
reports a directive that silences nothing.

## Components

Components in `webui/src/components/ui` belong to Gateship. They start from the
shadcn registry (`base-nova`, built on Base UI) and are adapted; see
`gateship-shadcn.md`. Tailwind owns styling and Hugeicons supplies icons.

| Rule | Check |
| --- | --- |
| A screen composes the kit and does not restyle it. Colour, typography and spacing a component owns are changed through a variant in the kit, never a class at the call site. Layout classes are free | Design lint `no-restyle` |
| Class names are static strings, so they can be read | Design lint `require-static-classes` |
| A list of comparable rows is the kit's `DataTable`: one frame, sans heads, 40px rows, its own empty row, skeleton rows on first load, dimmed rows on refresh | Behaviour tests |
| Controls in a table toolbar share one height: 32px, 36px below `sm` | Visual gate |
| A row carries at most one state badge | Judgment |
| Rows that wait on the operator are named by the screen (`needsOperator`) and drawn by the table | Behaviour tests |
| A secondary column declares the breakpoint it shows from (`hideBelow`). A narrow screen keeps what the row is about and does not scroll sideways for it | Visual gate at 390px |
| A row that has detail opens under itself with a chevron (`renderExpanded`). What it opens into is built only while it is open | Behaviour tests |
| A list the screen already holds is searched and paged with `useClientPage`; a list the server pages keeps the URL as its state | Behaviour tests |
| Every disclosure opens with the same chevron, owned by `CardSummary` and `CollapsibleTrigger`. No "open" and "close" labels, no native triangle | Behaviour tests |
| A section that is always there is a plain card (`SectionCard`). A disclosure is for what is optional | Judgment |
| Collapsed is a rendering state: the content of a disclosure and of a hidden tab stays mounted, so static rendering and find-in-page see it. The exception is a row's detail, which the list's search covers | Behaviour tests |
| `Stat` is a figure under a mono eyebrow. It is a link when a list sits behind the figure, and it can lead a group of related rows | Behaviour tests |
| A form field is a `FormField`, which owns the body size. A command is typed in `mono`. A form has one field per name, because a second one makes the browser return a list whose value is empty | Behaviour tests |
| A panel has one constructive primary action. Secondary and destructive actions look different from it. `CardFooter` exists only with actions, and is `sticky` only under a form that runs to screens of text | Judgment, behaviour tests |
| Reference text (how to sign in, how to set a channel up) folds once the thing it explains works, and opens by itself while it does not | Behaviour tests |
| An empty state says what is missing and offers the next action when there is one. No empty framed region | Judgment |
| Decorative charts are not part of the product. A chart has exact values one disclosure away, and tells its series apart by pattern as well as colour | Behaviour tests |

## Surfaces and navigation

| Address | What it is |
| --- | --- |
| `/overview` | Now: four figures and one table of projects, most urgent first |
| `/overview/runs` | Every run: quick views, search, filters, server-side paging |
| `/overview/queues` | One row per project queue, most urgent first |
| `/overview/insights` | History by window: delivery, autonomy, economy, outcomes by day, cohorts |
| `/projects` | The registered projects, and the guided path to add one |
| `/projects/:id`, `/projects/:id/runs` | The project's runs: the same table as `/overview/runs`, scoped by the path |
| `/projects/:id/runs/:runId` | One run: stage map, facts, activity, report, cost |
| `/projects/:id/work` | Queue, approval, ideas, diagnostics, proposals |
| `/projects/:id/settings` | Providers and models, execution, project and brief |
| `/settings` | Agents, operator, notifications, updates |
| `/`, `/runs` | The latest run of the current project. A "Gateship needs you" notification lands here |

| Rule | Check |
| --- | --- |
| The sidebar is one flat list that never reorders: Now, Runs, Queue, Insights. The project switcher above it is a filter; with a project selected, Runs and Queue open that project's own surfaces | Behaviour tests |
| The lower group holds Project settings (only with a project selected), Projects and Global settings, which keeps the last row | Behaviour tests |
| Every page has a row that is current on it, and its title matches that row | Behaviour tests |
| Collapsing the sidebar moves nothing: the icon axis stays at x=44, rows are 32px, and the first row sits on the line of the panel's controls (`--shell-inset`). Icon-only rows keep their label, tooltip and active background | Visual gate baselines |
| The project filter lives in the switcher. A surface does not carry a second project select; a `?projectId=` link still scopes it | Behaviour tests |
| Every screen puts what waits on the operator before autonomous activity, history and statistics | Judgment |
| A merged run does not repeat that its CI passed. A run's duration excludes the time it spent waiting on the operator | Behaviour tests |
| Plain links are the routing mechanism | Judgment |

## Responsive behaviour

| Rule | Check |
| --- | --- |
| At 390px every destination stays reachable and the sidebar becomes horizontal navigation | Visual gate baselines |
| Grids collapse to one column; a grid of fields stacks, and each field keeps a real label | Visual gate, behaviour tests |
| Interactive targets offer at least 44px to a coarse pointer. Labels wrap instead of being clipped | Kit defaults, judgment |
| Only the content panel scrolls on desktop. A bar that floats over it is opaque (`--color-muted-solid`) and rests on the column's fade | Judgment |

## Interaction and accessibility

| Rule | Check |
| --- | --- |
| Semantic elements, keyboard navigation, the skip link and visible focus rings are preserved. Focus uses the neutral ring token | Behaviour tests, judgment |
| `Alt+1` shows every project and `Alt+2` to `Alt+9` select the first eight projects, in the switcher's order. A recognised combination calls `preventDefault`; an unknown one, or an index with no project, is left to the browser. The visible link is always the fallback. Labels read `⌥` on macOS and `Alt` elsewhere | Behaviour tests |
| Movement lives behind `motion-safe:`. Under reduced motion only immediate or short opacity feedback remains. Routine navigation is not animated and nothing uses `transition: all` | Behaviour tests, judgment |
| Live output follows new events only while the operator is at the live edge | Behaviour tests |
| Scroll containers use `scroll-container`; long vertical surfaces add `scroll-fade`, a mask inside the viewport and never around a card | Judgment |
| `en-US` and `pt-BR` are both complete, and layouts tolerate the longer catalog without truncating an essential action | Behaviour tests, visual gate in both locales |
