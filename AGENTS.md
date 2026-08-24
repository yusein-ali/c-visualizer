# AGENTS.md — PLIVET

## What this project is

PLIVET (_Programming Language Interpreter for Visualization of Execution Trace_) is a
**browser-only program visualizer and step debugger**. The user writes C code in an
in-page editor, then steps forward/backward through execution while the runtime state
(call stacks, variables, arrays, pointer arrows) is drawn live on a canvas next to the
editor.

- The only supported language is **C/C++**. The unfinished Java and Python
  interpreters, and the machinery for choosing between languages, were removed.
- The interface is **English only**. There is no locale layer: every string the
  UI shows lives in [src/strings.ts](src/strings.ts).
- **There is no backend.** Everything — parsing, interpretation, stepping — runs in the
  browser. `src/core/server.ts` is a _simulated_ server: one `Server` per Worker,
  behind a `Request`/`Response` API kept in that shape so a real remote backend
  could be swapped in later. Do not add network calls expecting a server to exist.
- Ships as a static site: `npm run build` → `dist/`, deployed to the `gh-pages` branch by
  GitHub Actions. Demo: https://ryoskate.github.io/PLIVET

## Direction (read before proposing dependency work)

PLIVET has been rebuilt as a framework-free, browser-only widget — CodeMirror 6
instead of Ace, JointJS instead of react-konva, the interpreter in a Web Worker,
and no React at all — so that it can be embedded in an A+ Sphinx extension
alongside the `interactive-code` extension in the `ai-enabled-wearable-technology`
course repo. The interface is plain TypeScript and the DOM, a page holds as many
instances as it likes, and scope has narrowed to C only. Do not reintroduce
React, react-bootstrap, Bootstrap, jQuery, Enzyme, Java, Python, Ace, Konva or a
second interface language.

## Tech stack

| Concern       | Choice                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Language      | TypeScript 5.9, `strict`, `noUnusedLocals`/`noUnusedParameters`/`noImplicitReturns`                                               |
| UI            | No framework. `src/ui/**` — plain TypeScript classes over the DOM, one directory per widget, each with its own stylesheet         |
| Wiring        | `src/app/**` — the event bus, the theme, and the classes that connect the widgets to the interpreter                              |
| Code editor   | CodeMirror 6 — `src/ui/editor/`                                                                                                   |
| Console       | Plain DOM — `src/ui/console/`                                                                                                     |
| Core          | `src/core/` — interpreter session, step model and layout; no DOM, no renderer, enforced by ESLint                                 |
| Visualization | JointJS 4 — `src/ui/graph/`                                                                                                       |
| Interpreter   | [`unicoen.ts`](https://www.npmjs.com/package/unicoen.ts) 0.5.0 — deep imports like `unicoen.ts/dist/interpreter/Engine/ExecState` |
| Build         | webpack 5 + babel-loader (transpile only) + `fork-ts-checker-webpack-plugin` (types)                                              |
| Lint/format   | ESLint 9 (flat config, `eslint.config.js`) + Prettier 3 (single quotes, semicolons, es5 trailing commas)                          |
| Test          | Jest 29 + `ts-jest`, jsdom; widgets are tested through the DOM they build                                                         |

## Toolchain — read before running anything

- `.tool-versions`: **nodejs 24.15.0**. `package.json` enforces `>=24 <25` and
  pins `packageManager: npm@11.12.1`.
- Package manager is **npm** (`package-lock.json` is committed; CI uses `npm ci`).
  `yarn.lock` was removed with the move to npm. Do not reintroduce
  yarn or pnpm.
- There is intentionally no `.npmrc`: the `legacy-peer-deps` workaround was
  removed with react-konva. Do not restore it to hide dependency conflicts.
- `@babel/runtime` is a direct dependency because `@babel/plugin-transform-runtime`
  emits imports for it. It used to arrive transitively through React; removing
  React broke the build until it was declared.
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
npm start           # dev server on :8080 (/ is one instance, /dev.html is two)
npm run build       # production build into dist/ (+ dist/licenses.html)
npm run deploy      # embeddable assets into dist/embed/ (one script tag, hashed chunks)
npm test            # jest
npm run typecheck   # tsc --noEmit, no webpack
npm run lint        # eslint over the whole tree
npm run format      # prettier --write (the only command that rewrites source)
```

CI (`.github/workflows/test.yml`) runs `npm ci`, lint, typecheck, test and build
on Node 24.15.0 for every push/PR to `master`, and repeats the same run on the
next Node major as an advisory job that may fail without blocking.
`deploy-to-gh-pages.yml` builds and publishes `dist/` on push to `master`.

## Architecture

```
src/index.ts                 the public entry: `new Plivet(element, options)`
  └─ src/main.ts             the standalone page, mounting one into #c-visualizer (or #root)
  └─ src/embed.ts            `npm run deploy`: the same mount, plus `window.CVisualizer`, for a host page
  └─ app/Plivet.ts           owns the bus, the interpreter client and the theme
       ├─ ui/shell/          two-column CSS grid: five mount points, three drag handles, the footer
       ├─ ui/controls/       six debug buttons, text size, theme switch, step counter
       ├─ app/EditorController.ts → ui/editor/  (CodeMirror 6)
       ├─ ui/console/        a `pre` and a `textarea`
       ├─ ui/files/          a `details` panel, the upload input and the list
       ├─ ui/help/           the instructions, in a `dialog`
       └─ ui/graph/          PlivetGraph (JointJS paper and graph)
```

Two boundaries, both enforced by ESLint rather than remembered:

- `src/core/**` may import neither `src/app/**` nor `src/ui/**`.
- `src/ui/**` may not import `src/app/**`. A widget takes a mount element and an
  options object, holds no application state, and reports through callbacks —
  which is what lets one be lifted into the Sphinx extension unchanged.

### The event bus is the backbone

`src/app/emitter.ts` holds `Bus`, a typed event bus with a union of the events it
carries (`'debug' | 'changeTheme' | 'changeState' | 'changeOutput' | 'zoom' | 'draw'`)
and two methods: `signal(event, ...)` to emit and `slot(event, cb)` to subscribe.
The payload of each event is declared in `EventPayloads`, so a `signal` is checked
against the `slot` that answers it.

**One bus per instance**, constructed by `Plivet` and passed down — never
imported. It is a class for exactly that reason, and the Node `EventEmitter`
behind it (and the `events` polyfill) went at the same time.

Subscriptions are made **in constructors** and never removed one at a time;
`Bus.destroy()` drops all of them. Follow that existing pattern rather than mixing
in a new state solution; if you add an event, add it to the `event` union and
`EventPayloads` first — that union is the only registry.

### One debug step, end to end

1. `ControlBar` reports a button press and `Plivet` turns it into
   `bus.signal('debug', <CONTROL_EVENT>)`.
   Control events: `Start | Stop | Step | StepBack | StepAll | BackAll | Exec | SyntaxCheck`.
2. `EditorController.send()` builds a `Request { controlEvent, sourcecode, stdinText,
lineNumOfBreakpoint }` and awaits `client.send(request)` — the
   `InterpreterClient` its `Plivet` handed it, which posts the request to that
   instance's Worker.
3. `core/server.ts` lazily `import()`s the CPP14 interpreter (webpack chunk `CPP14`
   — still a dynamic import, to keep the parser out of the initial bundle and
   to leave one branch to add if a language ever comes back), drives
   `unicoen.ts`, and records every `ExecState` and its stdout into
   [src/core/history.ts](src/core/history.ts).
   **Step-back is history replay, not reverse execution** — `StepBack`/`BackAll` just
   move an index into that history, which retains the first state and the most
   recent `HISTORY_LIMIT` steps.
   `StepAll` loops with `setTimeout(…, 1)` so the UI stays responsive, and calls
   `onRunEvent` with `'EOF'` / `'stdin'` / `'Breakpoint'` when it needs to stop.
   `EditorController` sets that callback on the client; the core does not know
   the bus exists.
4. `EditorController.recieve()` (note the spelling) fans the `Response` out over
   its instance's bus: `signal('changeState', debugState, step)` → the control
   bar's enablement and the console's writability, `signal('changeOutput', …)` →
   the console, `signal('draw', stepModel)` → the graph. It also highlights the current
   statement in the editor.
5. The Worker turns the `ExecState` into a `StepModel` with
   [extractModel](src/core/extractModel.ts) — plain rows of cells, with every
   pointer resolved to the key of the cell it names. `PlivetGraph` lays it out
   with [layout](src/core/layout.ts), then renders custom JointJS table elements
   and routed links. Which aggregates are folded is the graph instance's
   `FoldState`, not the model's, so a fold survives a step.

Debug states (`DEBUG_STATE`): `First | Debugging | stdin | EOF | Stop | Executing`.
`enablementFor` in [src/ui/controls/enablement.ts](src/ui/controls/enablement.ts)
maps each state to which buttons are enabled, and to what the two forward
buttons mean there — change that switch when adding a state. The mapping is
total on purpose; the comment in that file says what went wrong when it was not.

### Other pieces

- **Breakpoints** — a CodeMirror gutter in [src/ui/editor/breakpoints.ts](src/ui/editor/breakpoints.ts),
  outside the line numbers, toggled by a click near its left edge.
  `lineNumOfBreakpoint` holds **0-based** rows; `unicoen.ts` `codeRange.begin.y` is
  **1-based** — the conversions in [src/ui/editor/positions.ts](src/ui/editor/positions.ts)
  and `server.StepAll` are deliberate.
- **Syntax check** — every edit schedules a debounced (1s, compare-then-run)
  `SyntaxCheck`; errors become `@codemirror/lint` diagnostics plus highlighted lines.
- **Stdin** — when the interpreter blocks on input, `debugState` becomes `'stdin'`, the
  Console's `textarea` becomes writable, and the line submitted with Enter comes back as
  `Request.stdinText`. The interpreter echoes what it reads into its own stdout, so the
  console never writes the typed line into the transcript itself.
- **File uploads** — `FilePanel` hands the chosen `FileList` to `Plivet`, which
  reads them as `ArrayBuffer` into its interpreter client; they cross to the
  Worker and reach the interpreter via `setFileList`, so C programs can `fopen`
  them. The map belongs to the client, so one instance's uploads are invisible
  to another's programs.
- **UI text** — one English table in [src/strings.ts](src/strings.ts), read
  directly (`strings.howToUse`). Keys assembled at runtime — `construct${kind}`,
  `${signal}${command}` — go through `stringFor(key)`. The three-file starter
  program is returned by [src/defaultProgram.ts](src/defaultProgram.ts).
- **Theming** — `'light' | 'dark'`, chosen from a `select` in the control bar and
  broadcast over `changeTheme`. The shell flips `plivet--dark` on its root, where
  `--plivet-surface`, `--plivet-ink`, `--plivet-line` and the three
  `--plivet-button-*` tokens are defined for both themes; the console flips its
  own class, and the editor reconfigures its CodeMirror theme. The visualization
  keeps a light paper in both themes — the cell palette is part of the drawing.

## Conventions

- 2-space indent, single quotes, semicolons, trailing commas — enforced by
  Prettier and ESLint. Run `npm run format` for formatting; builds do not rewrite
  source files.
- A widget is a class that takes `(parent: HTMLElement, options)`, appends its
  own root element, exposes `setX()` methods for what changes, and has a
  `destroy()`. Options carry callbacks (`onDebug`, `onUpload`, …), never the bus.
  `Plivet` itself follows the same shape, one level up.
- **Nothing is module-level state.** The bus and the interpreter client are
  constructed by a `Plivet` and passed to what needs them. A new `export const`
  holding a session, a cache or a registry breaks the second instance on a page,
  which is what per-instance state was introduced to prevent.
- Every widget carries its own appearance: a colocated stylesheet whose rules
  all sit under one `plivet-` class, or a CodeMirror theme. There is no shared
  stylesheet to register alongside a module lifted into another page. Colours are
  named through a fallback chain — `--plivet-*` → `--interactive-editor-*` →
  `--bs-*` → a literal — so a host page's palette wins and standalone the
  literals do.
- The webpack configs are commented in Japanese; keep them intact when editing.

## Testing

Jest is scoped to `roots: ['<rootDir>/test']` with `tsconfig.test.json`, and CSS
is mapped to `identity-obj-proxy`. New tests go under `test/` as `*.test.ts`.
Widgets are tested by mounting them into a `div` and driving real DOM events —
see `test/console.test.ts`, `test/controls.test.ts`, `test/files.test.ts` and
`test/shell.test.ts`. `test/instances.test.ts` does the same with two whole
`Plivet`s, and `test/client.test.ts` stands a fake Worker in for the real one,
which is the only way to drive `InterpreterClient` under Jest.

There is no e2e harness; verify interpreter and graph behaviour in a browser
with `npm start`, or against a production build served over http. `/dev.html`
holds two instances for checking that they stay out of each other's way.

## Gotchas

- **A misspelled name is load-bearing.** `EditorController.recieve()` is the
  actual identifier. Don't rename it incidentally — do it only as a deliberate,
  complete rename. (`src/components/menus/controle_buttons/` was the other one;
  it went with React.)
- **JointJS does not run under jsdom.** It turns its vectorizer off when
  `window.SVGAngle` is missing, and `V.prototype` ends up empty, so constructing
  a `dia.Paper` throws. A test that mounts something containing `PlivetGraph`
  stubs the module (`test/instances.test.ts` shows the shape); the canvas itself
  is checked in a browser.
- There is no Worker under Jest either: `jest.config.js` maps `spawnWorker` to a
  stub that throws, so a test that means to run a program uses `Server` directly
  and one that means to drive the client mocks `spawnWorker`.
- `HardSourceWebpackPlugin` caches into `node_modules/.cache/hard-source/`; delete it if
  the build behaves impossibly after dependency changes.
- `PlivetGraph.render()` rebuilds the JointJS scene for one visible step. During
  run-all, redraw is suspended until execution stops. Layout is pure and never
  mutates the model, so a step can be laid out repeatedly with different folds.
- Dependency history is dominated by Renovate bot PRs. `unicoen.ts` is frozen
  upstream and must not be bumped.
