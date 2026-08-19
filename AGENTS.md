# AGENTS.md — PLIVET

## What this project is

PLIVET (_Programming Language Interpreter for Visualization of Execution Trace_) is a
**browser-only program visualizer and step debugger**. The user writes C code in an
in-page editor, then steps forward/backward through execution while the runtime state
(call stacks, variables, arrays, pointer arrows) is drawn live on a canvas next to the
editor.

- The only supported language is **C/C++**. The unfinished Java and Python
  interpreters, and the machinery for choosing between languages, were removed
  in Phase 1 of `UPGRADE_PLAN.md`.
- The interface is **English only**. There is no locale layer: every string the
  UI shows lives in [src/strings.ts](src/strings.ts).
- **There is no backend.** Everything — parsing, interpretation, stepping — runs in the
  browser. `src/server.ts` is a _simulated_ server: an in-process singleton with a
  `Request`/`Response` API, kept in that shape so a real remote backend could be swapped
  in later. Do not add network calls expecting a server to exist.
- Ships as a static site: `npm run build` → `dist/`, deployed to the `gh-pages` branch by
  GitHub Actions. Demo: https://ryoskate.github.io/PLIVET

## Direction (read before proposing dependency work)

The stack below describes the code as it stands, not where it is going.
`UPGRADE_PLAN.md` is the active plan: PLIVET is being rebuilt as a
framework-free, browser-only widget — CodeMirror 6 instead of Ace, JointJS
instead of react-konva, the interpreter in a Web Worker, and no React at all —
so that it can later be embedded in an A+ Sphinx extension alongside the
`interactive-code` extension in the `ai-enabled-wearable-technology` course repo.
Scope has narrowed to C only. Do not upgrade React, react-bootstrap, Ace or
Konva, and do not reintroduce Java, Python or a second interface language.

## Tech stack

| Concern       | Choice                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Language      | TypeScript 5.9, `strict`, `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`                                               |
| UI            | React 16 **class components** (no hooks anywhere), `react-bootstrap` 0.33 / Bootstrap **3**                                       |
| Code editor   | CodeMirror 6 — `src/ui/editor/`, framework-free; `Editor.tsx` is only the wiring                                                  |
| Visualization | Konva via `react-konva` (`Stage` / `Layer` / shapes)                                                                              |
| Interpreter   | [`unicoen.ts`](https://www.npmjs.com/package/unicoen.ts) 0.5.0 — deep imports like `unicoen.ts/dist/interpreter/Engine/ExecState` |
| Build         | webpack 5 + babel-loader (transpile only) + `fork-ts-checker-webpack-plugin` (types)                                              |
| Lint/format   | ESLint 9 (flat config, `eslint.config.js`) + Prettier 3 (single quotes, semicolons, es5 trailing commas)                          |
| Test          | Jest 26 + `ts-jest` + Enzyme (adapter for React 16)                                                                               |

## Toolchain — read before running anything

- `.tool-versions`: **nodejs 24.15.0**. `package.json` enforces `>=24 <25` and
  pins `packageManager: npm@11.12.1`.
- Package manager is **npm** (`package-lock.json` is committed; CI uses `npm ci`).
  `yarn.lock` was removed in Phase 2 of `UPGRADE_PLAN.md`. Do not reintroduce
  yarn or pnpm.
- `.npmrc` sets `legacy-peer-deps=true` because `react-konva@16.9.0-1` declares
  peer `react@16.9.x` against the project's `react@16.14.0`. Delete it in the
  commit that removes react-konva (Phase 8/9).
- The browser policy is the `browserslist` key in `package.json`: the last two
  versions of Chrome, Firefox, Edge and Safari, plus Firefox ESR. It is what
  `@babel/preset-env` compiles against, and it is chosen to match CodeMirror 6,
  which ships modern syntax and is not transpiled (babel-loader excludes
  `node_modules`). Raising or lowering it is a decision, not a detail.
- Type checking and linting are separate from the build: `npm run typecheck`
  and `npm run lint` both run without webpack, and neither rewrites source. Use
  `npm run format` for that.
- `node_modules/` may not be installed in a fresh checkout — run `npm ci` first.

## Commands

```bash
npm ci              # install from the committed lockfile
npm start           # dev server on :8080
npm run build       # production build into dist/ (+ dist/licenses.html)
npm test            # jest
npm run typecheck   # tsc --noEmit, no webpack
npm run lint        # eslint over the whole tree
npm run format      # prettier --write (the only command that rewrites source)
```

CI (`.github/workflows/test.yml`) runs `npm ci` and `npm test` on Node 24.15.0
for every push/PR to `master`. `deploy-to-gh-pages.yml` builds and publishes `dist/` on
push to `master`.

## Architecture

```
src/index.tsx
  └─ AppContainer.tsx    holds the only top-level state: theme
       └─ App.tsx        two-column bootstrap Grid
            ├─ EditorSide.tsx → Menu (CtrlButtons) · Editor · Console · FileForm
            └─ CanvasSide.tsx → ScaleMenu · Canvas → CanvasContent → StackRect/…
```

### The event bus is the backbone

`src/components/emitter.ts` wraps a single Node `EventEmitter` with a typed event union
(`'debug' | 'changeState' | 'draw' | 'redraw' | 'changeOutput' | 'files' | 'stdin' |
'EOF' | 'Breakpoint' | 'zoom' | 'changeTheme'`) and two
helpers: `signal(event, ...)` to emit and `slot(event, cb)` to subscribe.

Components subscribe **in their constructors** and never unsubscribe (hence
`setMaxListeners(20)`). Follow that existing pattern rather than mixing in a new state
solution; if you add an event, add it to the `event` union first — that union is the
only registry.

### One debug step, end to end

1. `CtrlButtons` renders `CtrlButton`s that `signal('debug', <CONTROL_EVENT>)`.
   Control events: `Start | Stop | Step | StepBack | StepAll | BackAll | Exec | SyntaxCheck`.
2. `Editor.send()` builds a `Request { controlEvent, sourcecode, stdinText,
lineNumOfBreakpoint }` and awaits `server.send(request)`.
3. `server.ts` lazily `import()`s the CPP14 interpreter (webpack chunk `CPP14`
   — still a dynamic import, to keep the parser out of the initial bundle and
   to leave one branch to add if a language ever comes back), drives
   `unicoen.ts`, and records every
   `ExecState` into `stateHistory` plus stdout into `outputsHistory`.
   **Step-back is history replay, not reverse execution** — `StepBack`/`BackAll` just
   move an index into those arrays.
   `StepAll` loops with `setTimeout(…, 1)` so the UI stays responsive, and emits
   `'EOF'` / `'stdin'` / `'Breakpoint'` when it needs to stop.
4. `Editor.recieve()` (note the spelling) fans the `Response` out:
   `signal('changeState', debugState, step)` → Menu + CtrlButtons enablement,
   `signal('changeOutput', …)` → Console, `signal('draw', execState)` → Canvas,
   `signal('files', …)` → FileForm. It also highlights the current line in Ace.
5. `Canvas` stores the `ExecState` and constructs a `CanvasDrawer`, which turns stacks
   into `CanvasStack` → `CanvasRow` → `CanvasCell` (with `CanvasVariable` /
   `CanvasArrayVariable`) and resolves pointer values into `CanvasArrow`s via the
   module-level `pointerConnectionManager`. `CanvasContent` renders cells on one Konva
   layer and arrows on another.

Debug states (`DEBUG_STATE`): `First | Debugging | stdin | EOF | Stop | Executing`.
`CtrlButtons.componentWillReceiveProps` maps each state to which buttons are enabled —
change that switch when adding a state.

### Other pieces

- **Breakpoints** — `Editor.componentDidMount` hooks Ace's `guttermousedown` (only within
  25px of the gutter's left edge) and toggles `session.setBreakpoint(row, …)`.
  `lineNumOfBreakpoint` holds **0-based** Ace rows; `unicoen.ts` `codeRange.begin.y` is
  **1-based** — the `- 1` conversions in `Editor` and `server.StepAll` are deliberate.
- **Syntax check** — `Editor.onChange` fires a debounced (1s, compare-then-run)
  `SyntaxCheck`; errors become Ace annotations plus highlighted lines.
- **Stdin** — when the interpreter blocks on input, `debugState` becomes `'stdin'`, the
  Console becomes writable, and the typed text comes back as `Request.stdinText`.
- **File uploads** — `FileForm` reads files as `ArrayBuffer` into `server.files`, which is
  handed to the interpreter via `setFileList` so C programs can `fopen` them.
- **UI text** — one English table in [src/strings.ts](src/strings.ts), read
  directly (`strings.howToUse`). Keys assembled at runtime — `construct${kind}`,
  `${signal}${command}` — go through `stringFor(key)`. The starter program is
  the `sourceCode` entry in that same table.
- **Theming** — `'light' | 'dark'` broadcast over `changeTheme`; Ace switches
  `textmate`/`monokai`, and CSS classes `theme-light`/`theme-gray` come from
  `src/css/theme.css`.

## Conventions

- 2-space indent, single quotes, semicolons, trailing commas — enforced by Prettier
  through TSLint. Run `npm run ts-lint` (or just build: `tslint-loader` runs with `fix: true`
  during webpack, so building can rewrite your source files).
- React class components with an explicit `interface Props` / `interface State`; shared
  prop shapes (`ThemeProps`) live in
  [src/components/Props.ts](src/components/Props.ts) and are combined with `&`.
- Each component imports its own stylesheet from `src/css/`.
- Ace modes/themes must be imported explicitly (`ace-builds/src-min-noconflict/...`) or
  they will not be bundled.
- The webpack configs are commented in Japanese; keep them intact when editing.

## Testing

`test/App.test.tsx` is an Enzyme `shallow` smoke render of `AppContainer`.
Jest is scoped to `roots: ['<rootDir>/test']` with `tsconfig.test.json`, CSS mapped to
`identity-obj-proxy`, and TS diagnostic 2604 suppressed (a `react-numeric-input` typing
quirk). New tests go under `test/` as `*.test.tsx`. There is no e2e/browser test harness;
verify interpreter/canvas behavior manually with `npm start` (blocked until Phase 3).

## Gotchas

- **Misspelled names are load-bearing.** `src/components/canvas/scales/ScaleMune.tsx`
  (Menu), `src/components/menus/controle_buttons/`, and `Editor.recieve()` are the actual
  identifiers. Don't rename them incidentally — do it only as a deliberate, complete
  rename.
- `HardSourceWebpackPlugin` caches into `node_modules/.cache/hard-source/`; delete it if
  the build behaves impossibly after dependency changes.
- Both `Canvas.render()` and `CanvasContent` construct/consult `CanvasDrawer` on every
  render — the drawer is cheap-but-not-free, and `'redraw'` exists to recompute arrow
  positions without a new `ExecState`.
- Dependency history is dominated by Renovate bot PRs; the pinned old majors (webpack 4,
  React 16, Bootstrap 3, TSLint) are intentional, not neglected — don't "upgrade while
  you're in there."
- `README.md` mentions `bist/`; the output directory is `dist/`.
