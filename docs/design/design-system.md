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
| Sans is the voice of titles, navigation, labels, prose and the moment something happened. Mono is the voice of identifiers, commands, durations, costs and counters, and of the label that names a block or a column. A column head is `type-eyebrow`, the same caps mono as a section's label, so a name is never read as one of the values under it | Kit defaults (`TableHead`, `type-data`, `type-eyebrow`), judgment at the call site |
| Saans is not bundled. The interface uses the system sans until a repository asset and its licence are added | Judgment |
| Acid (`#c8ff00`) belongs to the mark and the wordmark alone. No surface, badge, counter, dot or button in the interface uses the attention family | Behaviour tests |
| Work waiting on the operator is said by order (most urgent first), by its state in the warning family and by text. No rule or border on the leading edge of a row, in any colour | Behaviour tests, judgment |
| The five state families share one lightness and one chroma in each theme, so no state shouts over another: on light, the base at L 0.64 C 0.17 and the text on a wash at L 0.50 C 0.13 (oklch). A palette's own steps do not do this: its purple 700 carried twice the chroma of its emerald 700 | Visual gate (AA), judgment |
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
| A page that has nothing to show yet shows the mark building its stair from the bottom in hard cuts, the shaft block by block and then the arrowhead (`PageLoading`) and says what it waits for. A skeleton is for a block that waits inside a page that is already there: a panel, the rows of a table. A page does not wear the shape of content it does not have. Under reduced motion the mark stands still | Behaviour tests |
| A list of comparable rows is the kit's `DataTable`: one frame, heads in the eyebrow, 40px rows, its own empty row, skeleton rows on first load, dimmed rows on refresh. A cell that holds a control gives up its padding, so the row stays 40px | Behaviour tests, visual gate baselines |
| The controls over a table are one group: 8px between its rows, a block's distance to the table. The pagination under it shares the toolbar's two edges | Behaviour tests, judgment |
| A moment is one column, day and time in sans with tabular figures, and the year only when it is not the current one | Behaviour tests |
| A row names what it is about: a run row shows the issue's id and its title. The title takes no width of its own, so it fills the slack and never widens the table | Visual gate baselines |
| Figures that come in groups open under the row. A closed row is one line | Behaviour tests |
| Controls in a table toolbar share one height: 32px, 36px below `sm` | Visual gate |
| Every control of that height shares one corner, 10px: button, input, select, toggle. The generous curve belongs to surfaces (cards, tables, popups) | Judgment |
| A table gives the width its columns do not need to one column, the one the row is about (`primary`, the first by default). Slack spread over every column reads as holes | Judgment |
| A secondary column declares the width it shows from (`hideBelow`), measured on the table itself and not on the window: beside an open sidebar a 1024px window leaves the table 672px. A narrow table keeps what the row is about and does not scroll sideways for it | Visual gate at 390px |
| A row that has detail opens under itself with a chevron (`renderExpanded`). What it opens into is built only while it is open | Behaviour tests |
| A list the screen already holds is searched and paged with `useClientPage`; a list the server pages keeps the URL as its state | Behaviour tests |
| Tabs keep one text size at every width and the open tab lives in the address as `?tab=`, so a link, a reload and the back button land on it. A row that scrolls sideways (tabs, quick views) fades at the edge it continues past, and brings its selected item into view | Behaviour tests |
| Everything that opens wears one chevron, the kit's `DisclosureChevron`: a card's summary, a collapsible, a table row, a list row. Same glyph and turn, 16px in a header and 14px in a row, always in a 16px slot so the label starts 24px in. Its own `<details>` turns it, never a group, so a disclosure nested in an open one stays still. No "open" and "close" labels, no native triangle | Behaviour tests |
| A disclosure at page level is a card (`CardDisclosure`); inside a card it is a `Collapsible`, and a row of a list is its `bare` form. No card inside a card. A screen writes no `<details>` of its own | Contract test, behaviour tests |
| A section that is always there is a plain card (`SectionCard`). A disclosure is for what is optional | Judgment |
| Collapsed is a rendering state: the content of a disclosure and of a hidden tab stays mounted, so static rendering and find-in-page see it. The exception is a row's detail, which the list's search covers | Behaviour tests |
| Short labels have one job each. `Badge` is the state or class of something, in its semantic wash, never solid, never with an icon, one per row. `StatusDot` is the life of a run, a dot and its name, moving only while the run does. `Tag` is a fixed attribute with no hue, the only one that may lead with an icon. `Reference` is an id, mono, a link when there is somewhere to go. `Count` is a number beside a label. What can be toggled is a `ToggleGroup`, never a badge | Behaviour tests, judgment |
| A short label starts with a capital and leaves the rest as written, one or two words, in the words the stage map already uses. The kit capitalises, so a catalog entry in lower case still reads right. The runtime's raw ids never reach the screen | Behaviour tests |
| `Stat` is a figure under a mono eyebrow. It is a link when a list sits behind the figure, and then it carries an arrow at rest, because a touch screen has no hover. A lone figure sits on the foot of its card, so the figures of one row share a line however their labels wrap. A figure that leads a group of rows puts them under itself, and beside itself once the card is wide enough for both | Behaviour tests |
| A grid of cards takes its columns from the room it has, not from the window (`CardGrid` is a container) | Judgment |
| Every surface shares one text inset, 16px: a `Stat`, the first and last cell of a table, and a card's header, panel and footer. Stacked blocks have one text edge. Between columns a table keeps 12px | Behaviour tests, visual gate baselines |
| A card names and describes itself in its header (`CardDescription`, held to a reading measure) and its panel starts with the content. A disclosure is the exception: its description stays inside, so closed it is one line | Behaviour tests |
| A table inside a card keeps its border and gives up its own ring: the card's ring already holds it | Judgment |
| A form field is a `FormField`, which owns the body size and the field's measure: a name or a choice in 448px, prose in a reading measure, `full` inside a grid that already sizes it. A box beside its text is a `CheckField`. A screen writes no `<label>` of its own | Contract test, behaviour tests |
| A boolean that acts the moment it is flipped is a `Switch`; one that waits for the form's save is a checkbox. Both wear the product's ink, never the acid | Behaviour tests |
| A command is typed in `mono`. A form has one field per name, because a second one makes the browser return a list whose value is empty | Behaviour tests |
| The actions of a block close it on its own edge, in a card's footer or at the foot of a nested form, in the same order everywhere | Judgment |
| A panel has one constructive primary action, and it closes the row: last on the end edge, at the bottom when the actions stack. What cannot be undone comes first and wears the danger family as an outline, never a solid block that competes with the primary. On a run, the primary is what the state asks for (ship when ready, resume when interrupted) | Behaviour tests |
| A button keeps one text size at every width. A screen writes no `<button>` of its own; the ones that are not a `Button` (a tab, a list row) are recorded with their reason in `webui/src/design/exceptions.ts` | Contract test, both directions |
| `CardFooter` exists only with actions, and is `sticky` only under a form that runs to screens of text | Judgment, behaviour tests |
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
| The sidebar is one flat list that never reorders: Now, Runs, Queue, Insights, and with a project selected its own settings close the group. The project switcher above it is the filter alone, with no other rows; with a project selected, Runs and Queue open that project's own surfaces | Behaviour tests |
| The lower group never changes: Projects and Global settings, which keeps the last row | Behaviour tests |
| Every page has a row that is current on it, and its title matches that row. The controls row is the panel's, not the content's: its toggles sit on the panel's edges whatever measure the content keeps, and the title on the panel's true centre | Behaviour tests |
| The switcher's trigger belongs to the project's name. Open, it carries no shortcut chip (the menu's rows teach the shortcut) and writes the state out only when it moves or waits; idle is the hollow dot. On the rail the chip is the trigger | Behaviour tests |
| A count says how many, and says nothing when there are none: `Count` renders no element at zero, in a sidebar row, a tab, a view toggle or the bell. Unknown is a dash, never a zero | Behaviour tests |
| A screen has one left edge and one right edge, shared by the controls row and every block under it, at every breakpoint. The outer ring is that edge: cards, groups of figures, tables and queues all carry it. Nothing reserves a scrollbar gutter: a reserved gutter is dead space on a platform whose scrollbars overlay, and it pushed the content 11px inside the controls above it. The controls row, which is the panel's, keeps its buttons 24px from the panel's line on both sides, where the content's edge is | Visual gate baselines, judgment |
| Blocks sit 24px apart, a tab list and its panel included | Judgment |
| Collapsing the sidebar moves nothing: the icon stays at x=36, rows are 32px, and the first row sits on the line of the panel's controls (`--shell-inset`). A rail tile is the row cut to its icon, 12px either side of the glyph, so one margin of 24px stands between the window and the tile, the tile and the panel, the panel and its first control. Icon-only rows keep their label, tooltip and active background | Visual gate baselines, judgment |
| The project filter lives in the switcher. A surface does not carry a second project select; a `?projectId=` link still scopes it | Behaviour tests |
| Every screen puts what waits on the operator before autonomous activity, history and statistics | Judgment |
| The stage map joins its stages with a real line, darker where the run has been, so the line reads the progress too. It takes its label size from its own width, and below `sm` it is one row of dots with a caption that names where the run is. A run with no stage history draws no map: a sentence says so | Behaviour tests |
| A run's address opens that run, however old: one the recent list no longer carries is read by its id, and an unknown id says not found with the way back, never that the project has no runs | Behaviour tests |
| An activity line is one line: when, who, the phase as a tag, what. Below `sm` its detail is one truncated line, and the disclosure holds the rest | Judgment |
| A merged run does not repeat that its CI passed. A run's duration excludes the time it spent waiting on the operator | Behaviour tests |
| Plain links are the routing mechanism | Judgment |

## Responsive behaviour

| Rule | Check |
| --- | --- |
| Below `lg` the shell is an app: the switcher on top, the controls row as the app bar (mark, centred title, actions) and a tab bar at the foot with the four lists and More, which holds the settings and the registry. The tab bar is the last row of the column, not a layer over the content | Behaviour tests, visual gate baselines |
| Grids collapse to one column; a grid of fields stacks, and each field keeps a real label | Visual gate, behaviour tests |
| Interactive targets offer at least 44px to a coarse pointer. Labels wrap instead of being clipped | Kit defaults, judgment |
| The centred layout is a container of 80rem on the panel's centre, with 24px gutters, as the large products do; when the panel is a little wider than the measure the small remainder splits to both sides. The wide preference releases the measure: every block fills the panel, a table included, and a reading measure lives on the block that needs it (a field, a card's description) | Judgment |
| Only the content panel scrolls on desktop. A bar that floats over it is opaque (`--color-muted-solid`) and rests on the column's fade | Judgment |

## Interaction and accessibility

| Rule | Check |
| --- | --- |
| Semantic elements, keyboard navigation, the skip link and visible focus rings are preserved. Focus uses the neutral ring token | Behaviour tests, judgment |
| `Alt+1` to `Alt+9` select the first nine projects, in the switcher's order, and `Alt+A` shows every project at once, which is no number in that list. `Alt` with an arrow walks the destinations, wrapping at the ends. `Alt+P` opens the registry, `Alt+,` the global settings and `Alt+B` folds the sidebar. A recognised combination calls `preventDefault`; an unknown one, an index with no project, or a key pressed inside a field is left to the browser. The visible link is always the fallback. Labels read `⌥` on macOS and `Alt` elsewhere | Behaviour tests |
| A key shows where it is true. A menu teaches its keys permanently, in a right-hand column, because it is a surface the operator opens on purpose. A row that opens a menu shows none: the menu it opens already carries them. A row with a key of its own shows a chip at its right on hover and on keyboard focus, in a slot it keeps at rest so no text moves. The pair that walks the destinations is relative, so it rides the current row alone and is never declared as that row's own key. A control that is only a glyph has nowhere to put a chip, so its hint carries its name and then its key | Behaviour tests, judgment |
| A project is the digit that selects it, drawn by the icon set as a 16px square the switcher wears open or collapsed; every project at once is the grid of squares, and past the ninth the square is the empty one. Glyphs come from the icon set alone, never from a chip of borders and monospaced text beside them. A menu row leads with the mark that says it is current, in a column that is there either way, and closes with its shortcut, as every platform's menus do. On the rail a hint carries the key: the switcher's own, and the pair that walks the destinations | Behaviour tests, judgment |
| Movement lives behind `motion-safe:`. Under reduced motion only immediate or short opacity feedback remains. Routine navigation is not animated and nothing uses `transition: all` | Behaviour tests, judgment |
| Live output follows new events only while the operator is at the live edge | Behaviour tests |
| Scroll containers use `scroll-container`; long vertical surfaces add `scroll-fade`, a mask inside the viewport and never around a card | Judgment |
| `en-US` and `pt-BR` are both complete, and layouts tolerate the longer catalog without truncating an essential action | Behaviour tests, visual gate in both locales |
