# PLIVET upgrade plan

## Goal

Rebuild PLIVET as a framework-free, browser-only widget that runs today from a
local `index.html` served over http, and can later be embedded in an A+ Sphinx
extension without a second rewrite.

Two things change at once, and the plan keeps them in separate phases: the
runtime and build system are modernized first, then the application is
rearchitected on top of them. The deliverable of this plan is the standalone
application. Every architectural decision in it is nonetheless chosen so that the
eventual extension work is a lift-and-shift of finished modules rather than a
port.

## Scope

In scope:

- Node, npm, Webpack, TypeScript and lint toolchain.
- Replacing Ace with CodeMirror 6 and react-konva with JointJS.
- Moving the interpreter into a Web Worker.
- Removing React and its satellite libraries entirely.

Not in scope for now:

- No Sphinx directive, no A+ active elements, no grader submission. Phase 12
  records what that work will need so the constraints below are not quietly
  dropped.
- No visual redesign. Parity with the current UI is the target.
- No new interpreter work, and no Java or Python. Those interpreters were never
  finished and are removed in Phase 1; C is the only supported language.
- No standalone `file://` support. The application is served over http(s); the
  Worker introduced in Phase 6 requires a real origin.

## The superseded approach

An earlier version of this document modernized the React application in place:
upgrade React 16 to a supported major, migrate react-bootstrap 0.33 to 2.x and
Bootstrap 3 to 5, replace Enzyme with React Testing Library, and keep Ace and
react-konva.

That approach was dropped after measuring what React actually does here. Fourteen
of the twenty-six components hold no state at all; of the thirty-three `setState`
calls in the rest, seventeen fire from inside `slot()` subscriptions on the
global event bus; and `Editor` keeps its real state — `sourcecode`,
`lineNumOfBreakpoint`, `isDebugging` — in plain instance fields outside React.
React is a rendering shim over `emitter.ts`, and `emitter.ts` is already the
architecture.

Removing it costs about the same as upgrading it, deletes the Bootstrap 3 to 5
migration entirely, and removes `react-konva`, which is the package that would
otherwise force a lockstep React major upgrade. It also produces a widget that
can be embedded in a course page, which the React application cannot.

## Target baseline

- Node.js: latest patched 24.x LTS release.
- npm: latest npm 11 release supported by that Node.js release.
- One package manager: npm only, with a committed `package-lock.json`.
- Webpack 5 and webpack-dev-server 5, `target: ["web", "es2020"]`.
- TypeScript 5 and a current Babel 7 toolchain.
- ESLint in place of TSLint.
- CodeMirror 6 for editing, JointJS for the visualization, no UI framework.
- C only. The Java and Python interpreters are removed.
- CI and local development use `npm ci`, `npm test`, `npm run build`, `npm start`.

Pin exact Node and npm versions in development and CI, while expressing the
supported major versions in `package.json`. This gives reproducible installs
without forcing every patch-level update to edit the engine range.

## Constraints that keep the extension cheap later

These are the decisions that make Phase 12 a small job instead of a rewrite. They
cost little now and are expensive to retrofit.

1. **Mount into an element, do not own the page.** The public entry point is
   `new Plivet(element, options)`. `index.html` is a host page that happens to
   contain one instance, not the application itself. This mirrors
   `InteractiveEditor(text, parentElement, ...)` and
   `SignalChainCanvas(element, {...})` in the course's existing extensions.
2. **No module-level singletons.** Three exist today and all three break the
   moment two instances share a page: the event bus at
   `src/components/emitter.ts:2`, the interpreter at `src/server.ts:372`, and
   `pointerConnectionManager` at `src/components/canvas/CanvasDrawer.ts:136`.
   Each becomes instance-scoped and is passed explicitly.
3. **Scoped styles only.** `src/index.tsx:4` imports Bootstrap globally; in a
   course page that would restyle everything around it. All CSS moves under a
   single `plivet-` class prefix and no global stylesheet is imported.
4. **The editor sits behind an adapter.** PLIVET's debugger features attach to a
   CodeMirror `EditorView` through a narrow interface. Standalone, PLIVET
   constructs the view itself; embedded, the host's `InteractiveEditor` supplies
   one through its `editor()` accessor and the same debug extensions are added
   with `StateEffect.appendConfig`. Nothing in the debugger may assume it owns
   the editor's construction, its language configuration, or its theme.
5. **The toolchain matches the extensions repository:** npm, Webpack 5,
   `target: ["web", "es2020"]`, ES modules. Code moved later needs no build
   changes.
6. **The Worker protocol carries plain data only.** No class instances cross the
   boundary, in either direction.

## Facts this plan relies on

Verified against the current tree; re-check if the code moves.

- `src/server.ts` is already a `Request`/`Response` protocol behind a single
  `send()`, discriminated by `controlEvent`. It is a message protocol in all but
  name.
- `src/components/canvas/CanvasDrawer.ts` imports no renderer. Its only outward
  coupling is `signal('redraw')` at line 533, inside `toggleFold()`.
- `ExecState`, `Stack`, `Variable` and `UniNode` are classes with private fields
  and methods. They are not structured-cloneable and cannot be posted to a
  Worker.
- `stateHistory` in `src/server.ts` grows by one deep-copied `ExecState` per step
  and is never trimmed.
- Java and Python support is shallow: one `ProgLang` union, one three-branch
  dynamic import, eight `progLang` call sites in `src/server.ts`, one emitter
  event, one selector, and two sample programs per locale. Removing it is
  deletion, not refactoring.
- Webpack 4 does not run on Node 24, and **there is no escape hatch**. The
  md4/OpenSSL 3 hashing failure that `--openssl-legacy-provider` works around is
  a Node 17-20 era problem this environment never reaches: the build now dies
  earlier, in css-loader 5, which requires `postcss/package.json` — a subpath the
  package's `exports` map does not expose. Every CSS import fails. Because
  `webpack.config.dev.js` is `merge(baseConfig, …)`, the dev server fails
  identically, so `npm start` is dead too. Measured on Node 24.15.0; see
  `baseline/results/RESULTS.md`. Consequences: no runnable local build or dev
  server until Phase 3, and no phase before it can have an exit criterion that
  inspects build output. `npm test` is unaffected — Jest never touches webpack.
- `unicoen.ts` is frozen at 0.5.0, last published in 2022. It is the interpreter
  and it will not be upgraded. Its `scanf` dependency is why the build needs an
  `fs` fallback.

## Phase 0: baseline

1. Run the current application in an isolated Node 16 environment and record the
   results of `yarn test`, `yarn build`, and a browser smoke test.
2. Write down the functional checklist that defines parity: load the editor,
   switch language, run a sample, step forward and backward, set and hit a
   breakpoint, trigger a syntax error, supply stdin, upload and delete a file,
   toggle theme, switch UI language, zoom.
3. Capture screenshots of the visualization for two or three representative
   programs, including one with pointers and one with an array.
4. Record a run-to-breakpoint timing on a program of at least a few hundred
   steps. This is the benchmark Phases 5 and 7 are measured against.

Exit criterion: parity and performance are defined in writing, and known existing
failures are documented so they are not confused with migration regressions.

## Phase 1: reduce scope to C

Deleting the unfinished interpreters before migrating anything is strictly
cheaper than porting them, so this comes first and runs under the existing build.

Both kinds of language choice go: the programming language, and the user
interface language. Neither is wanted, and each was threaded through the same
components, so they came out together.

1. Remove `ProgLang` and `ProgLangProps` from `src/components/Props.ts`, and
   `Lang` and `LangProps` with them. Only `Theme` and `ThemeProps` remain.
2. Collapse `createInterpreter` in `src/server.ts` to its single CPP14 branch
   and drop the `progLang` parameter from `Request`, `Start`, `Exec` and
   `SyntaxCheck`.
3. Remove `changeProgLang` and `changeLang` from the emitter event union.
   `AppWithLang` becomes `AppContainer` and holds `theme` alone; nothing else
   is threaded through `App`, `EditorSide` or `Editor`.
4. Delete `LangAndHow` and the `Switch` component it was the only user of.
   `Menu` renders `HowToUseButton` directly. `react-select` was only ever used
   by `Switch`, so it leaves `package.json` too.
5. Replace `src/locales/{en,ja}.ts` and `translate(lang, key)` with a single
   English `src/strings.ts`, read as `strings.key`; keys assembled at runtime
   go through `stringFor(key)`. `sourceCodeJava` and `sourceCodePython` are
   deleted and `sourceCodeCcpp` becomes plain `sourceCode`, so
   `Editor.sourceCodeKey()` is gone.
6. Drop `Editor.componentWillReceiveProps` entirely. It existed only to swap
   the sample program when either language changed; with no language to change,
   the harder of the two legacy lifecycle methods disappears rather than
   shrinking, and Phase 9 has one less thing to rewrite.
7. `libraryHelp` entries lose their `ja` column; `en` becomes `description`.
8. Update `README.md`, which advertised Java and Python as "now implementing".

The mechanism stays even though the branches go: the interpreter is still loaded
through a dynamic import (Phase 3, step 12). Adding a language back later means
restoring a branch, not rebuilding an architecture.

Exit criterion: no reference to Java, Python or a second interface language
remains in `src/`, the C sample still loads and runs, and the `Java8` and
`Python3` chunks no longer appear in the build output.

## Phase 2: standardize on npm

1. Change `engines` to support Node 24 and npm 11, and add a `packageManager`
   declaration for the chosen npm 11 patch release.
2. Update `.tool-versions` to the selected Node 24 patch and remove the Yarn pin.
3. Replace Yarn calls in scripts: `yarn clean` becomes `npm run clean`,
   `yarn license` becomes `npm run license`. Remove `deduplicate`; npm performs
   lockfile deduplication and offers `npm dedupe` when an explicit pass is needed.
4. Replace the Husky 4 `package.json` configuration with current Husky hooks, or
   temporarily remove the install-mutating pre-commit hook. A pre-commit hook
   must not reinstall all dependencies or rewrite the lockfile.
5. Generate `package-lock.json` with the target npm version. Remove `yarn.lock`
   only in the same reviewed commit, after a successful clean npm install.
6. Verify that a fresh checkout installs with `npm ci`.

Exit criterion: npm is the only package manager referenced by source-controlled
configuration and scripts.

## Phase 3: build and development server

Upgrade as a coherent set, because the Webpack packages expose coupled plugin and
loader APIs: Webpack 5, webpack-cli, webpack-dev-server 5, webpack-merge,
html-webpack-plugin, fork-ts-checker-webpack-plugin, webpack-bundle-analyzer,
babel-loader, css-loader, style-loader, and the asset-module replacements for
file-loader and url-loader.

1. Change webpack-merge usage to its current named `merge` export.
2. Remove HardSourceWebpackPlugin and enable Webpack 5 filesystem caching with
   `cache: { type: 'filesystem' }`.
3. Remove `thread-loader` and `happypack`. Restore parallelism only if
   measurements show it materially improves this small application.
4. Replace `node: { fs: 'empty' }` with `resolve.fallback: { fs: false }`. This
   is load bearing: `unicoen.ts` pulls in `scanf`, which requires `fs`.
5. Replace `file-loader` and `url-loader` rules with asset modules.
6. Set `target: ["web", "es2020"]`.
7. Move type checking to a current ForkTsCheckerWebpackPlugin configuration.
8. Add an explicit `devServer` configuration for port 8080, history fallback,
   hot reload and client logging.
9. Remove `opener` from the `start` script and let webpack-dev-server or the VS
   Code `serverReadyAction` open the browser. This avoids opening an unmanaged
   browser before the debugger attaches.
10. Enable the bundle analyzer only through an explicit environment variable or a
    separate `analyze` script; it should not start during every debug session.
11. Retain source maps and confirm breakpoints bind to files under `src/`.
12. Keep the interpreter behind a dynamic import, now a single `CPP14` chunk.
    Without a server everything ships to the browser, and deferring the parser
    until the first run keeps the editor interactive on load. This is the one
    piece of the current build worth preserving as-is.

Exit criterion: `npm start` serves the application on port 8080 under Node 24,
and `npm run build` produces a working production bundle without legacy OpenSSL
flags.

## Phase 4: TypeScript and linting

1. Upgrade TypeScript to 5.x and the Babel TypeScript preset together. Keep
   `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`.
2. Remove TSLint, its plugins and configs, and `tslint-loader`.
3. Add ESLint with TypeScript support, plus a separate `lint` script. Linting
   must not mutate source files during a production build.
4. Convert the existing `tslint:disable` comments to narrowly scoped ESLint
   directives, or fix the underlying issues.
5. Add a standalone `typecheck` script using `tsc --noEmit`.
6. Raise the ES5 output target to the oldest browser the project still intends to
   support, and document that browser policy. The current `>0.25%, not ie 11`
   target predates the rest of this plan.

Exit criterion: `npm run lint` and `npm run typecheck` pass independently of
Webpack.

## Phase 5: extract the portable core

The two files worth keeping are `server.ts` (372 lines) and `CanvasDrawer.ts`
(535 lines). This phase makes them independent of the UI so later phases can move
them freely. The React application keeps working throughout.

1.  Create `src/core/` and move both files into it. Nothing in `src/core/` may
    import from `src/components/`.
2.  Define the plain-data step model that will later cross the Worker boundary.
    Approximately:

        interface CellModel   { key, text, kind, width, pointerTarget?, foldGroup? }
        interface StackModel  { name, rows: CellModel[][] }
        interface StepModel   { step, debugState, output, codeRange,
                                stacks: StackModel[], pointers: {from, to}[] }

    Everything in it must survive `structuredClone`.

3.  Split `CanvasDrawer` along that seam:
    - `extractModel(execState): StepModel` — walks stacks and variables, resolves
      pointer targets by key. Depends on `unicoen.ts`, not on geometry.
    - `layout(model, foldState): Geometry` — the existing `calcPos`,
      `alignToMaximumWidth`, `rescaleWidthForLongFuncName` and arrow routing.
4.  Move fold state out of the cells and into a main-thread structure keyed by
    cell key. Delete the `signal('redraw')` call at line 533; `toggleFold` returns
    and the caller re-lays-out. A model must not emit UI events.
5.  Make `pointerConnectionManager` an instance owned by the layout pass rather
    than a module singleton.
6.  Cap `stateHistory`. Either bound the number of retained states or keep
    periodic snapshots and replay forward. Without a server this is the user's own
    memory, and a long loop currently grows it without limit.

Exit criterion: `src/core/` builds and is unit-testable with no DOM, no React and
no renderer. The application still passes the Phase 0 checklist.

## Phase 6: interpreter in a Web Worker

1. Move `Server` into `src/core/interpreter.worker.ts`, instantiated with
   `new Worker(new URL('./interpreter.worker.ts', import.meta.url))`.
2. Keep the existing `Request` shape as the message in. Replace the `Response`
   `execState` field with `StepModel` from Phase 5, produced by calling
   `extractModel` inside the Worker.
3. Wrap the Worker in a client with the same `send(request): Promise<Response>`
   signature the components already call, so call sites do not change.
4. Replace the `setTimeout(loop, 1)` yield in `StepAll` with a straight loop. It
   exists only to keep the main thread alive and is unnecessary in a Worker.
   Keep breakpoint, stdin and EOF as messages out.
5. Transfer uploaded files (`Map<string, ArrayBuffer>`) to the Worker once, on
   change, rather than riding on every response.

Exit criterion: stepping and run-to-breakpoint work with the interpreter off the
main thread, and run-to-breakpoint beats the Phase 0 benchmark.

## Phase 7: CodeMirror 6

Build the new editor in `src/ui/editor/`, wired to the same event bus, behind the
adapter described in constraint 4. From here through Phase 9, build behind a
second Webpack entry point so every commit leaves a working application.

1. Add the CodeMirror 6 packages: `state`, `view`, `language`, `commands`,
   `autocomplete`, `lint`, `lang-cpp`, and a dark theme. Mirror the language
   and indent configuration in
   `interactive-code/static/js/interactive_code_editor.js`, which already solves
   this for C.
2. Breakpoint gutter: a `StateField` holding the breakpoint set, a `StateEffect`
   to toggle, and a `gutter()` with a marker. Keep the current rule that only
   clicks near the gutter's left edge toggle. Breakpoints stay 0-based rows;
   `codeRange.begin.y` from the interpreter stays 1-based. Keep the conversion in
   one place and test it.
3. Current-step highlight: a `Decoration` in a `StateField`, updated per step,
   plus `EditorView.scrollIntoView`.
4. Syntax diagnostics: map `SyntaxErrorData` to `@codemirror/lint` diagnostics.
   This needs a line and column to absolute-offset conversion that Ace did not
   require. Keep the existing one-second debounce.
5. Replace the edit-during-debug modal with read-only enforcement: while a debug
   session is live the document is read-only, and restarting releases it. This
   deletes roughly fifty lines of modal code and matches what the host editor
   already offers through `forceReadOnly()`.
6. Package steps 2 to 4 as a single exported extension array. This array is the
   whole of what the Sphinx extension will later need to attach to a host editor.

Exit criterion: the editor passes the Phase 0 checklist, and the debug extensions
are exported as a standalone array that attaches to any `EditorView`.

## Phase 8: visualization on JointJS

1. Add `@joint/core`. Note the licence: it is MPL-2.0 against PLIVET's MIT. This
   is fine for a dependency but should be a recorded decision, and the
   `licenses.html` generation must keep working.
2. Build `src/ui/graph/` around a `dia.Paper`, consuming the `Geometry` produced
   by `layout()`. One instance per PLIVET instance.
3. Implement the stack frame as a custom `dia.Element`: a table of rows and
   columns, per-cell horizontal gradient fill, black stroke, monospace text. Fold
   toggles are cell clicks that call back into the fold state from Phase 5.
4. Replace `pointerConnectionManager`'s manual three-point spline arrows with
   JointJS links and a router. This is the largest single deletion in the plan.
5. Replace the zoom slider and spinner with paper scaling.
6. Add expression-expansion visualization to the canvas for the current
   statement when it contains binary or ternary operators. Extend `StepModel`
   with plain-data expression nodes and evaluation results from the Worker, then
   render the operands, operators, evaluation order and intermediate values in
   JointJS without sending interpreter or AST class instances across the Worker
   boundary. Include also the assignment if applicable so that expression expansion forms a
   complete statement.
7. Address redraw cost before considering this phase done. The current code
   rebuilds the entire scene per step; an SVG graph cannot absorb that during a
   run. Either diff the graph against the previous `StepModel`, or suspend
   redraws while `debugState` is `Executing` and draw once on stop. Measure
   against the Phase 0 benchmark.

Exit criterion: the visualization matches the Phase 0 screenshots, folding and
zoom work, and run-to-breakpoint does not regress against Phase 6.

## Phase 9: remove React

Build the replacement shell under `src/ui/` as plain TypeScript classes, each
taking a mount element and an options object, each subscribing to an
instance-scoped bus.

1. Layout: `App`, `EditorSide`, `CanvasSide` and `Menu` are 171 lines of
   Bootstrap grid. They become static markup plus CSS grid, under the `plivet-`
   prefix.
2. Controls: the six debug buttons, the step counter and the debug status. The
   `DEBUG_STATE` to enablement mapping in
   `CtrlButtons.componentWillReceiveProps` is worth preserving as-is; it is the
   only real logic in the component. Replace the five Bootstrap Glyphicons with
   inline SVG.
3. Console: a `pre` for output and a `textarea` for stdin. It is currently a
   second Ace editor.
4. Files: a file input, a list, and a Blob URL download, replacing
   `react-download-link` and the Bootstrap panel.
5. User-interface language and theme switches: native `select` elements,
   replacing `react-select`. The programming-language switch is already gone
   from Phase 1.
6. Zoom: dropped in favour of paper scaling from Phase 8.
7. Internationalisation: `translate()` is currently called during render, so
   React re-renders on language change for free. Replace it with an explicit pass
   that re-applies strings to labelled nodes on `changeLang`. This is the one
   capability being hand-written rather than deleted.
8. Delete the second entry point and cut over. Remove `react`, `react-dom`,
   `react-ace`, `react-konva`, `react-bootstrap`, `react-container-dimensions`,
   `react-numeric-input`, `react-select`, `react-download-link`, `rc-slider`,
   `enzyme`, `enzyme-adapter-react-16`, `react-test-renderer`, the `@types/react*`
   packages, `@babel/preset-react`, and `jsx` from the TypeScript configuration.

Exit criterion: the Phase 0 checklist passes with no React in the dependency
tree.

## Phase 10: instance scoping

1. `emitter.ts` becomes a class. Each PLIVET instance constructs its own bus and
   passes it to its components. The typed event union stays; it is the registry.
2. The Worker client is per instance. Two instances on one page must not share
   interpreter state, history or uploaded files.
3. Export `new Plivet(element, options)` as the only public entry. `index.html`
   constructs one.
4. Add a development page containing two instances side by side and confirm they
   do not interfere: stepping one must not move the other.

Exit criterion: two independent instances run on one page.

## Phase 11: tests, CI and maintenance

1. Upgrade Jest and its TypeScript support as a compatible set, moving the
   deprecated ts-jest `globals` configuration into `transform`. Drop Enzyme and
   the React 16 adapter; without React there is no component-testing library to
   choose.
2. Unit-test `src/core/` directly: `extractModel` against recorded `ExecState`
   fixtures, `layout` geometry, the breakpoint line-number conversion, the
   `DEBUG_STATE` to enablement mapping, and history replay for step-back.
3. Test the debug extension array against a headless `EditorView`.
4. Keep a small DOM-level smoke test that constructs a `Plivet` instance and
   steps once.
5. CI runs `npm ci`, lint, typecheck, test and build on the pinned Node and npm
   baseline.
6. Add a second, non-blocking CI job for the next supported Node major so future
   runtime problems are visible early.
7. Configure dependency updates in small groups: build tooling, tests, editor and
   graph libraries, interpreter dependencies. `unicoen.ts` is frozen upstream and
   should be excluded from automated updates.
8. Run `npm audit` and review findings manually. Do not use forceful automatic
   upgrades that can cross major versions without tests.

Exit criterion: the Phase 0 checklist is covered by automated tests wherever it
can be, and CI is green from a clean dependency cache.

## Phase 12: deferred to the extension

Recorded here so the constraints above are not quietly dropped. Not in scope now.

- A Sphinx directive plus asset registration, following `interactive-code.py` and
  `vspe_assets.py` in the `ai-enabled-wearable-technology` repository. Possibly a
  mode on the existing interactive-code directive rather than a new one.
- Substituting the host's `InteractiveEditor` for PLIVET's own editor through the
  Phase 7 adapter, attaching the debug extensions with
  `StateEffect.appendConfig`.
- `output.publicPath`, or a runtime `__webpack_public_path__`, so the interpreter
  chunks and the Worker resolve under Sphinx `_static`.
- Deciding how local stepping coexists with the grader's remote Execute: the
  interactive-code block submits to A+ for grading, while PLIVET interprets
  locally for study. They are complementary, not competing.

## Acceptance checklist

- A fresh checkout installs with `npm ci` on the documented Node and npm
  versions.
- `npm start` serves PLIVET at `http://localhost:8080`.
- The VS Code launch configuration starts the server and attaches Chrome, and
  breakpoints bind in `.ts` source files.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run build` pass.
- The Phase 0 functional checklist passes, or each deviation is explicitly
  accepted.
- No React, Ace or Konva packages remain.
- No module-level mutable singletons remain in `src/core/` or `src/ui/`.
- Two instances coexist on one page without interference.
- No global stylesheet is imported; all rules are prefixed.
- The interpreter runs in a Worker and only plain data crosses the boundary.
- Run-to-breakpoint beats the Phase 0 benchmark.
- No scripts or documentation require Yarn or Node 16.
- CI uses the lockfile and passes from a clean dependency cache.

## Pull-request sequence

1. Baseline, parity checklist and performance benchmark.
2. Reduce scope to C; delete the Java and Python interpreters, samples and
   selector.
3. npm conversion and lockfile migration.
4. Webpack 5 and development server.
5. TypeScript 5, ESLint and Prettier.
6. Extract `src/core/`, split `CanvasDrawer`, define `StepModel`.
7. Bound `stateHistory`.
8. Worker client and Worker; `StepAll` without the timer.
9. CodeMirror editor, behind the second entry point.
10. Debug extensions: breakpoints, step highlight, diagnostics.
11. JointJS graph, behind the second entry point.
12. Redraw diffing or suspension, measured against the benchmark.
13. Shell: layout, controls, console, files, switches.
14. Instance scoping and the `Plivet` entry point.
15. Cut over; delete React and the old entry point.
16. Tests, CI and dependency-update automation.

Each pull request must leave install, lint, typecheck, test and build green.
Phases 7 to 9 stay behind the second entry point precisely so that this holds.
Avoid combining the npm lockfile transition with any behavioural change.
