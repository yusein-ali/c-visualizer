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
- Teaching features built on CodeMirror 6, in Phase 12, after parity is
  proven.

Not in scope for now:

- No Sphinx directive, no A+ active elements, no grader submission. Phase 13
  records what that work will need so the constraints below are not quietly
  dropped.
- No visual redesign. Parity with the current UI is the target up to and
  including Phase 11; Phase 12 adds to the editor without redrawing the
  application.
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

These are the decisions that make Phase 13 a small job instead of a rewrite. They
cost little now and are expensive to retrofit.

1. **Mount into an element, do not own the page.** The public entry point is
   `new Plivet(element, options)`. `index.html` is a host page that happens to
   contain one instance, not the application itself. This mirrors
   `InteractiveEditor(text, parentElement, ...)` and
   `SignalChainCanvas(element, {...})` in the course's existing extensions.
2. **No module-level singletons.** Three existed, and all three break the moment
   two instances share a page. `pointerConnectionManager` is gone: Phase 5 made
   it local to one extraction and one layout. The event bus at
   `src/components/emitter.ts:2` and the interpreter session exported at the
   foot of `src/core/server.ts` went in Phase 10 - the bus is now a `Bus` an
   instance constructs, and the session is an `InterpreterClient` it owns, both
   passed explicitly. `src/core/server.ts` exports the `Server` class and no
   instance of it: the Worker constructs its own, one per Worker and one Worker
   per client.
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
7. **The source is a named set of files, not a string.** `Request.sourcecode` in
   `src/core/server.ts` is a single translation unit, `#include` is discarded by
   the preprocessor (`src/interpreter/preprocess.ts:238`), and the `files` map on
   the same class is a virtual filesystem for `fopen`, not source. The
   interactive-code directive PLIVET is meant to embed in is multi-file by
   design: directives sharing a `:block_id:` render as editor tabs, exactly one
   of them is the main file, `:hidden:` parts are editable and submitted without
   appearing inline, and every part goes into the same submission. A block whose
   files PLIVET can only concatenate is not embeddable. So carry a list of
   `{ path, text }` records plus an entry path through the Worker protocol
   (Phase 6) and the editor adapter (Phase 7) from the start, even while only one
   entry is ever populated. Widening a string afterwards touches every
   `controlEvent` branch, the breakpoint and step-highlight line mapping, and the
   Worker message shapes at once.

## Facts this plan relies on

Verified against the current tree; re-check if the code moves.

- `src/core/server.ts` is already a `Request`/`Response` protocol behind a single
  `send()`, discriminated by `controlEvent`. It is a message protocol in all but
  name.
- `src/core/` imports no renderer and no interface code at all, and ESLint fails
  the build if it starts to.
- `ExecState`, `Stack`, `Variable` and `UniNode` are classes with private fields
  and methods. They are not structured-cloneable and cannot be posted to a
  Worker.
- History grows by one deep-copied `ExecState` per step. Since Phase 5 it is
  bounded: the first state plus the most recent `HISTORY_LIMIT`.
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

**Status: complete.** `baseline/` holds the parity checklist, the screenshots and
the programs behind them, the capability probes, and the run-to-breakpoint
benchmark with the targets it sets for Phases 5 to 8. The defects that were
already there are recorded as expected, in `baseline/results/RESULTS.md`.

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

**Status: complete** (`49cda77`). No reference to Java, Python or a second
interface language remains in `src/`.

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

**Status: complete** (`d5b7103`). Node 24.15.0 and npm 11.12.1 are pinned, and
`package-lock.json` is the only lockfile.

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

**Status: complete** (`990fbe1`). `npm start` serves on port 8080 and
`npm run build` produces a working production bundle under Node 24, with no
legacy OpenSSL flag and the interpreter still in its own `CPP14` chunk.

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

**Status: complete** (`f68a815`). `npm run lint` and `npm run typecheck` both run
without webpack, and neither rewrites source.

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

**Status: complete, with two deviations.** `src/core/` holds the interpreter
session, the step model, the extraction pass, the layout and the bounded
history; `CanvasDrawer` is gone, split in two. ESLint enforces the boundary
rather than leaving it to memory: `src/core` may not import from
`src/components` or `src/ui`.

The deviations are both in the model. `StepModel` carries `stacks`, `pointers`
and `codeRange` but not `step`, `debugState` or `output` - those are already
fields of `Response`, and duplicating them before the Worker exists would mean
two copies to keep in step; Phase 6 folds the model into the response that
carries them. And a `fold` cell carries `foldTarget`, the group it shows and
hides, next to the `foldGroup` it belongs to: a group has to be named by
something, and naming it after the row it hangs from is what lets a fold be
addressed without a cell to hold it.

Fold behaviour changed as a consequence, for the better: a fold is a property
of what the reader is looking at, so opening an array and stepping no longer
closes it, and a group nested inside a folded one stays folded when its parent
is opened.

The two files worth keeping are `server.ts` (372 lines) and `CanvasDrawer.ts`
(535 lines). This phase makes them independent of the UI so later phases can move
them freely. The React application keeps working throughout.

1.  Create `src/core/` and move both files into it. Nothing in `src/core/` may
    import from `src/components/`. (completed - `server.ts` reports a run that
    stopped on its own through `onRunEvent` instead of the bus, and the
    `'redraw'`, `'EOF'`, `'stdin'` and `'Breakpoint'` events left the emitter
    with it.)
2.  Define the plain-data step model that will later cross the Worker boundary.
    Approximately:

        interface CellModel   { key, text, kind, width, pointerTarget?, foldGroup? }
        interface StackModel  { name, rows: CellModel[][] }
        interface StepModel   { step, debugState, output, codeRange,
                                stacks: StackModel[], pointers: {from, to}[] }

    Everything in it must survive `structuredClone`. (completed -
    [src/core/model.ts](src/core/model.ts), asserted in `test/core.test.ts`.)

3.  Split `CanvasDrawer` along that seam:
    - `extractModel(execState): StepModel` — walks stacks and variables, resolves
      pointer targets by key. Depends on `unicoen.ts`, not on geometry.
    - `layout(model, foldState): Geometry` — the existing `calcPos`,
      `alignToMaximumWidth`, `rescaleWidthForLongFuncName` and arrow routing.

    (completed. The split was checked against the old drawer before it was
    deleted: for every step of four programs, the geometry the two produce -
    stack and cell positions, widths, texts, colours and arrow points - is
    identical.)

4.  Move fold state out of the cells and into a main-thread structure keyed by
    cell key. Delete the `signal('redraw')` call at line 533; `toggleFold` returns
    and the caller re-lays-out. A model must not emit UI events. (completed -
    [src/core/foldState.ts](src/core/foldState.ts), owned by `Canvas`. Groups
    are named by the path of keys that reaches them, so a nested fold is a
    prefix test.)
5.  Make `pointerConnectionManager` an instance owned by the layout pass rather
    than a module singleton. (completed - it split with everything else:
    resolving an address to a cell key is `AddressTable`, private to one
    `extractModel` call, and placing the arrows is local to one `layout` call.)
6.  Cap `stateHistory`. Either bound the number of retained states or keep
    periodic snapshots and replay forward. Without a server this is the user's own
    memory, and a long loop currently grows it without limit. (completed -
    [src/core/history.ts](src/core/history.ts) retains the first state and the
    most recent `HISTORY_LIMIT` steps. The first is kept unconditionally because
    `BackAll` returns to the beginning of the program however long the run;
    stepping back stops at the window, and stepping forward out of a dropped
    stretch resumes at it. The first cut of this guard compared against the
    oldest retained step, which in a session short enough to retain everything
    is step 1 - so stepping back stopped one short of the beginning. It now
    asks whether the previous step is still held, which is the question that
    was meant; `test/core.test.ts` walks a session back to step 0 to keep it
    honest.)

Exit criterion: `src/core/` builds and is unit-testable with no DOM, no React and
no renderer. The application still passes the Phase 0 checklist. Met:
`test/core.test.ts` exercises extraction, layout, folding and history on real
interpreter states with nothing rendered.

## Phase 6: interpreter in a Web Worker

**Status: complete, with one deviation.** The interpreter runs in
`src/core/interpreter.worker.ts` and nothing but plain data crosses to the page.
Run-to-breakpoint on `baseline/programs/bench.c` went from **1653 ms to 327
ms** - measured on this machine against a build of the commit before this
phase, so the two numbers are comparable in a way the Phase 0 figures recorded
elsewhere are not. The Phase 0 target was "roughly 350 ms". Heap growth over 200 steps
fell from 27.2 MB to 9.4 MB: the `ExecState`s are the Worker's now, and only the
model it extracted is retained on this side.

The deviation is item 4. A completely straight loop cannot be stopped: `Stop` is
a message, and a Worker that never returns to its event loop never reads one.
The loop runs `RUN_SLICE` steps - 5000 - and then yields once, which is the
difference between a run that can be interrupted and one that cannot; at 1.21 ms
a step that is a Stop honoured within about six seconds in the worst case, and
immediately in every case that matters, against the one-step-per-millisecond
ceiling the old timer imposed. A run is retired by number rather than by a
handle, so stopping or restarting cannot reach into a run it does not own.

Single-stepping costs **3.3 ms against 2.6 ms** before, which is the one figure
that moved the wrong way. It is the message round trip itself and not the work:
stubbing out the per-step variable extraction changed nothing (3.4 ms). A step
is human-paced, and the phase buys a fivefold gain on the one operation that is
not.

1. Move `Server` into `src/core/interpreter.worker.ts`, instantiated with
   `new Worker(new URL('./interpreter.worker.ts', import.meta.url))`.
   (completed - the `new URL` is alone in
   [src/core/spawnWorker.ts](src/core/spawnWorker.ts) because `import.meta` is
   module syntax a CommonJS build cannot express, and the tests run under one;
   `jest.config.js` maps that one file to a stub.)
2. Keep the existing `Request` shape as the message in. Replace the `Response`
   `execState` field with `StepModel` from Phase 5, produced by calling
   `extractModel` inside the Worker. (completed. `model` is not optional: a
   state the interpreter has none for is an empty model rather than a missing
   one, because everything downstream of the response draws it. `Request` and
   `Response` became interfaces - `structuredClone` keeps an object's fields and
   throws its prototype away, so a class was a lie about what arrives.)
3. Wrap the Worker in a client with the same `send(request): Promise<Response>`
   signature the components already call, so call sites do not change.
   (completed - [src/core/client.ts](src/core/client.ts). The Worker starts on
   the first command rather than on load.)
4. Replace the `setTimeout(loop, 1)` yield in `StepAll` with a straight loop. It
   exists only to keep the main thread alive and is unnecessary in a Worker.
   Keep breakpoint, stdin and EOF as messages out. (completed, sliced - see the
   deviation above.)
5. Transfer uploaded files (`Map<string, ArrayBuffer>`) to the Worker once, on
   change, rather than riding on every response. (completed. `Response.files`
   and the `'files'` bus event are both gone with it: `FileForm` uploaded the
   list, so `FileForm` already knew it, and the round trip only told it what it
   had just said.)

Two things had to become plain data before any of it could cross. A
`SyntaxErrorData` holds its accessor as an instance property, and a function is
the one thing `structuredClone` refuses outright, so the message is unwrapped
into `SyntaxErrorModel`. And the editor's tooltip read variables off the running
`ExecState`, which no longer exists on this thread: `extractVariables` in
[src/core/variables.ts](src/core/variables.ts) reads them in the Worker, and
`hoverText.ts` is left with how to say them rather than how to find them.

Exit criterion: stepping and run-to-breakpoint work with the interpreter off the
main thread, and run-to-breakpoint beats the Phase 0 benchmark. Met, and checked
in a browser rather than only in tests: stepping, run-to-breakpoint, a full run
to EOF, stopping a two-million-iteration run mid-flight and running again after
it, and the variable, pointer, array, struct and library tooltips.

## Phase 7: CodeMirror 6

**Status: complete.** `src/ui/editor/` holds the editor, the
breakpoint gutter, the step highlight, the `@codemirror/lint` diagnostics and the
read-only debug session that replaced the modal; `DebugExtensions` and
`attachDebugExtensions` export the array a host view takes through
`StateEffect.appendConfig`, and `test/editor-extensions.test.ts` covers the
line-number conversion against a headless view. Commit `49cda77` replaced Ace
inside the only entry point while also completing Phase 1. That historical
ordering cannot be changed without reintroducing Ace. The CodeMirror/Konva
application served as the stable baseline while a separate `migration.html`
entry hosted Phase 8. That entry was removed when the JointJS graph replaced
Konva at `index.html`.

Two things step 1 asked for were finished in the Phase 9 commit, because that is
when a theme could first be chosen at all. `@codemirror/theme-one-dark` supplies
the dark highlight style, and `ThemeControl` now builds its two themes from two
palettes rather than one: light and dark had shared every literal, so `dark:
true` changed which highlight style CodeMirror believed it was under and left
the editor white behind it. The strings the deleted edit-during-debug modal used

- `editInDebug`, `continueDebug`, `restart`, `rememberCommand` and `warning` -
  went with it.

Build the new editor in `src/ui/editor/`, wired to the same event bus, behind the
adapter described in constraint 4. From here through Phase 9, build behind a
second Webpack entry point so every commit leaves a working application.

0. Correct typedef tooltips to use formal C terminology without claiming that
   `typedef` gives anything a storage class. (completed: type declarations now
   identify the introduced typedef name or tag and reserve storage-class
   reporting for declarations of objects.)
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

**Status: complete.**
The primary `/index.html` entry owns one `dia.Graph`/`dia.Paper` through
`src/ui/graph/`. The temporary migration entry and the complete react-konva
canvas tree are gone. `@joint/core` is pinned to 4.3.1. Its MPL-2.0 licence is
compatible with use as an unmodified dependency of this MIT application, and
the generated `dist/licenses.html` includes the package and its full licence
text.

The process memory is drawn as a memory map rather than through the stack
tables: `layoutMemory` in [src/core/memoryLayout.ts](src/core/memoryLayout.ts)
places one node per segment in two columns - the registers over the stack on
the left, and the heap, BSS, initialized data, read-only memory and text
descending on the right - every node the same width and sharing one set of
columns, and a
`plivet.MemoryNode` element draws each as a titled box - the segment's name and
the addresses it covers - over a table of objects. An object is two bands: its
type and size written small above its identifier, in the reading font, and its
value, which ends the row so that a pointer's arrow leaves from the right-hand
edge and arrives at the address column of what it names. Members are indented
under the aggregate that holds them, the stack's rows are grouped under the
frame that declared them, and a segment holding nothing at this step says so on
one line instead of showing a bare header. Each segment collapses to its own
title bar - a click anywhere on the bar, which keeps the name, the addresses
and a chevron - so that a reader watching the stack can put the rest of the
address space away; the state lives beside the aggregate folds in
`FoldState`, and the shared columns keep their widths so that nothing else on
the map moves when one segment closes. A pointer is drawn from the row of
the object that holds the address to the row of the object at it, along the
edges of their nodes rather than into the address column: two rows in the same
column of segments are joined on their left-hand edges, out in the gutter
beside them, and two in different columns on the sides that face each other. Values are printed as the declared
type can hold them - `narrowToType` wraps to the width and sign of the type,
so an unassigned `int` reads as a negative number rather than as raw bytes -
and addresses are padded to the width they occupy. The stack tables and
`layout` remain for a step that carries no segments.

The expression window sits under the memory map rather than beside it, and it
expands the statement the editor is highlighting: the operators, the operands
under them, and what each name holds going in. It used to show the statement
that had just finished, numbered in evaluation order, which read as a different
program the moment a call suspended one - the caller's half-evaluated
assignment against a line inside the callee. `ExpressionRecorder` now attaches
the statement about to run, and `extractModel` fills the operands in from the
variables it has already extracted, where the execution state is assembled.

Read-only memory holds the string literals as well as the `const` objects with
static storage. A literal is never a variable - the engine writes its bytes
into the low code area and hands the address to whatever named it, so
`ExecState`, which only walks scopes, has never seen one - and
`PlivetCPP14Engine.stringLiterals()` reads them back out. Nor does the engine
write out every literal: one that initializes a pointer or an array is put in
memory and its address handed over, while one passed to a call - the format
string of a `printf`, the name and mode `fopen` is given - is passed as bytes
and never given a home, so the program is walked for its literals as well as
the memory. Each takes a display address in the read-only band, which is also
what a `const char *` naming it is shown to hold, so the pointer's arrow lands
on the string. A `const` local stays on the stack, where its storage really
is.

Every segment, and every named object in one, starts on a four-byte boundary
(`MEMORY_ALIGNMENT`): these are the addresses the memory view prints, and a
band that begins mid-word reads as a mistake rather than as the packing it is.
Inside an aggregate the members are still laid out as C lays them out, so a
`char[5]` is five consecutive addresses.

The graph renders the existing layout through a custom JointJS stack-table
element and routed links, retains fold state, and uses paper scaling instead of
the canvas slider/spinner. `StepModel` now also carries a plain evaluated
expression tree and seven explicit process bands: registers, text, read-only,
initialized data, BSS, heap and stack. Declaration metadata records initializer
and object-const status so named variables land in the correct band; synthetic
static and heap allocations are de-duplicated against named objects. Every band
has its own displayed base, and register objects use `R0`, `R1`, ... slots.

Run redraw is suspended by the existing `Editor.recieve()` guard: an
`Executing` response updates read-only state and returns without emitting
`draw`; the Worker emits one final model when it stops. Unit coverage verifies
plain Worker payloads, expression order/results, segment placement, independent
bases and persistent folds. The production build and licence generation pass.
A like-for-like direct `Server` run to the 271-step benchmark breakpoint was
257 ms at the pre-Phase-8 boundary and 259 ms here (five-run medians after one
warm-up), so expression recording adds no material interpreter regression. That
is not the required UI/paint measurement: the Phase 6 browser timing and
screenshot comparison still need a browser run because no controllable browser
was available in this workspace. Use the primary launch configuration and the
protocol in `baseline/README.md` before declaring the exit criterion met.

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
   complete statement. This is the picture half of Phase 12 item 13, which
   frames the same expansion with an explanation of the statement around it, and
   the evaluation nodes added to `StepModel` here are the runtime half of the
   construct tooltips in Phase 12 item 4. The data is built once and drawn three
   ways.
7. Address redraw cost before considering this phase done. The current code
   rebuilds the entire scene per step; an SVG graph cannot absorb that during a
   run. Either diff the graph against the previous `StepModel`, or suspend
   redraws while `debugState` is `Executing` and draw once on stop. Measure
   against the Phase 0 benchmark.
8. Convert canvas to visualize the C-program memory along with standard segments and registers.
9. The variables must be properly visualized in the segments: registers, heap, stack, read-only memory (data and bss must be properly separated)
10. Each segment must have their own start addresses
11. Give each segment a node of its own with a table inside it, rather than a
    cascade of stack tables. **Done.** The address a row occupies is carried on
    the cell (`CellModel.address`) and its size is annotated onto the variable
    (`plivetSize`), so the memory view writes an address column and a
    type-and-size caption without re-parsing the text the stack table wants.
    What remains open is the connection between an object and the memory cells
    it covers, which wants its own visual module rather than more table.
12. Place the segments as a reader uses them - registers and stack on the left,
    the rest of the address space beside them - print values to the width of
    their type, and put the expression window underneath. **Done.**
13. Align the segments and the objects in them to four bytes. **Done.** What
    item 10 still wants is separate: a segment's objects take their display
    addresses from the frame they were declared in, not from the segment's own
    base, so a `const` global is shown in read-only memory carrying an address
    from the data range.

14. Let the reader decide what the canvas draws. **Done.** The graph toolbar
    carries a disclosure - "View", painted as one of the zoom buttons and
    opening a panel drawn in the map's own palette - holding one checkbox per
    memory region and one for the expression under them. The answers live in
    `ViewOptions` beside `FoldState` in the core. A region that is not shown is
    dropped before `layoutMemory` runs rather than hidden after it, so the map
    closes up over it and the pointers into it go with its rows; that is what
    tells it from a collapsed segment, which keeps its title bar and its place.
    A region nobody has switched is drawn only while it holds something -
    barring the four bands items 17 and 18 keep on the map - so a program that
    puts nothing in its BSS has no BSS on the canvas and the box ticks itself
    on at the first object that lands there - the switches say what the map is
    drawing at this step, not what was last clicked - while a region the reader
    answered for keeps their answer as the folds do. A step is drawn as a map
    or as the call-frame tables according to whether the model carries memory,
    so switching every region off leaves an empty map rather than bringing the
    tables back. Phase 12 item 16 wants the same panel for the teaching views;
    this is the half of it that the visualization owns.
15. Draw a pointer that crosses between the columns down the gap between them.
    **Done.** Both ends already touched the sides that face each other, but the
    line between them was handed to a router, which drew a pointer running
    right to left back through the node it started in. Every arrow is now
    given its lane by the layout: down the outside of its own column when both
    ends are in it, and down the space between the columns when it crosses,
    one lane per crossing, with the right-hand column moved over to make the
    room. No arrow on the memory map is routed by JointJS any more.

16. Give a heap block the address `malloc` gave it. **Done.** Display
    addresses were assigned by walking a stack's variables and packing them
    one after another, which for the heap closed the hole a `free` leaves:
    every block above the freed one moved down onto an address that another
    pointer still held, so two live pointers read as the same address and both
    drew an arrow into the same block. A block named `Heap:<address>` now takes
    its display address from the heap band and the offset the engine gave it
    (`ENGINE_HEAP_BASE` in
    [src/interpreter/RuntimeTypeInfo.ts](src/interpreter/RuntimeTypeInfo.ts)),
    so freed storage leaves a gap in the addresses, a pointer to it names
    nothing on the map and is drawn with no arrow, and the reader can see the
    fragmentation. This is item 13's rule - a segment's objects take their
    addresses from the segment - applied to the one band where reusing an
    address is visibly wrong; the static bands still take theirs from the walk.
17. Start read-only memory and the text segment on the map and put away.
    **Done.** Both hold what the program was loaded with rather than what it is
    doing - the code, and the constants and string literals beside it - so
    their tables say the same thing at every step, and a reader stepping
    through a program is watching the stack rather than re-reading the
    literals. They are drawn as their title bars until a click opens one, and
    they are drawn whatever they hold: a bar saying where the code and the
    constants live is worth its one line even at a step that has put nothing in
    them, which is the one place the empty-band rule of item 14 does not apply.
    Both defaults are `startsCollapsed` and `startsShown` in
    [src/core/model.ts](src/core/model.ts), where the regions are named, rather
    than at the two call sites that used to spell each rule out.
18. Keep the stack and the heap on the map, and put them away while they are
    empty. **Done.** They are the two bands a reader steps through a program to
    watch, and under item 14's rule they were the two that arrived late: the
    stack appeared at the first call and the heap at the first `malloc`, so the
    map taught that a band exists once something is in it. Both now join the
    static pair in `ALWAYS_SHOWN`, and `startsCollapsed` does the rest - an
    empty segment is its title bar alone, so the map says where the first frame
    and the first allocation will land without spending a table on a row saying
    the band is empty, and each opens itself as soon as the program puts
    something there. Only the registers, the BSS and the initialized data are
    left to the empty-band rule, and the reader's own answer still overrides
    all of it.
19. Dress the canvas toolbar as the editor's control bar. **Done.** The two
    panels a reader works between had two sets of buttons: the control bar's
    joined groups, and three lone buttons over the paper wearing a heavier font
    and a palette of their own. The toolbar now carries the same geometry, the
    same joined group and the same `--plivet-button-*` paint, and the zoom
    buttons are the control bar's own magnifiers from
    [src/ui/controls/icons.ts](src/ui/controls/icons.ts) rather than a minus, a
    percentage and a plus. What the "100%" button used to say is now written
    beside them, announced as the step counter is and for the same reason:
    pressing a magnifier changes nothing else a reader who is not watching the
    drawing would notice. The disclosure keeps the right-hand end of the bar,
    because the panel hangs from that edge - and the bar itself has left the
    scrolling box: it was `position: sticky` inside it, which held it to the
    top of the view but not to the left of it, so a drawing wider than the box
    carried the bar and the open panel sideways out of sight, and the panel
    that did stay was clipped at the edge of the box it was in. The paper now
    scrolls in a window of its own below the bar, which is the frame of that
    window rather than a thing floating in it. Only the icons are shared -
    `controls.css` is not imported here - so a canvas mounted alone still
    paints its own buttons.
20. Put a pointer's ends down on the blank top of the address cell. **Done.**
    Both ends stopped just outside the node - three pixels off its border, at
    the middle of the row - so the head was drawn in the gutter beside the
    table rather than on the thing it names, and it met the border rather than
    the cell. The address column spans the caption band as well as the
    object's own, because the address belongs to the whole object, and its
    upper half is blank: the caption starts at the name column beside it. That
    is the one part of a row an arrow can be put down on without covering
    something, so an arrow that meets a node on the address side - which is
    every arrival in the left-hand column, every crossing into the right-hand
    one, and every departure from it - now ends twelve pixels inside the node
    on that band, with the whole head over the cell. An end that meets a node
    on the other side stops outside it as before: the value is written out to
    the edge of its cell, and there is nothing to land on. Links are drawn
    over the nodes (`z`), so a head inside one is a head a reader can see.

Exit criterion: the visualization matches the Phase 0 screenshots, folding and
zoom work, and run-to-breakpoint does not regress against Phase 6.

## Phase 9: remove React

**Status: complete.** There is no React, react-bootstrap, Bootstrap, jQuery or
Enzyme left: `npm install` removed 139 packages, and the only `react-*` entry
left in the lockfile is `react-is`, which Jest's `pretty-format` depends on.
`src/components/` is gone.

What replaced it splits along the line the Sphinx extension will need. Widgets
live under `src/ui/` — `shell`, `controls`, `console`, `editor`, `graph`,
`files`, `help` — and each takes a mount element and an options object, holds no
application state, and reports through callbacks. The wiring lives under
`src/app/`: the bus, the theme, the hover text source, `EditorController` (what
`Editor.tsx` was once the `div` and the ref came off it) and `PlivetApp`, which
constructs the widgets and connects them. ESLint enforces the direction:
`src/ui/**` may not import from `src/app/**`, as `src/core/**` may import
neither.

The entry point was `src/index.ts` and the bus was module-level, which Phase 10
changed: `src/main.ts` is the page and the bus belongs to the instance. The
event union is typed per event rather than `any[]`, which is what made the
fan-out in `PlivetApp` - now `Plivet` - checkable.

1. Layout: `App`, `EditorSide` and `Menu` are Bootstrap grid/components.
   Bootstrap grid. They become static markup plus CSS grid, under the `plivet-`
   prefix. **Done.** `src/ui/shell/` is the two-column grid, the five mount
   points and the footer, at the same breakpoints Bootstrap was being asked
   for. The four stylesheets under `src/css/` went with it. The three
   boundaries a reader sizes for themselves - between the columns, under the
   editor and under the canvas - carry a `Splitter` each: a drag, or an arrow
   key, writes a length onto `--plivet-side-width`, `--plivet-editor-height`
   or `--plivet-graph-height` on the root, and the breakpoint proportions stay
   where they were, as the fallback of each `var()`.
2. Controls: the six debug buttons, the step counter and the debug status. The
   `DEBUG_STATE` to enablement mapping in
   `CtrlButtons.componentWillReceiveProps` is worth preserving as-is; it is the
   only real logic in the component. Replace the five Bootstrap Glyphicons with
   inline SVG. **Done.** `src/ui/controls/` holds the bar; `enablement.ts` moved
   with it unchanged, and `icons.ts` draws all nine icons as inline paths.
3. Console: a `pre` for output and a `textarea` for stdin. It is currently a
   second Ace editor.
4. Files: a file input, a list, and a Blob URL download, replacing
   `react-download-link` and the Bootstrap panel. **Done.** `src/ui/files/` is a
   `details` element, which is what the Bootstrap panel's collapse was for.
5. User-interface language and theme switches: native `select` elements,
   replacing `react-select`. The programming-language switch is already gone
   from Phase 1. **Done**, and only the theme switch was left to build: Phase 1
   deleted the interface language along with `react-select`. The switch is a
   `select` in the control bar. It replaces `ThemeButton`, which no component
   ever rendered — which is why the editor's missing dark palette, fixed under
   Phase 7 above, had never been seen.
6. Zoom: dropped in favour of paper scaling from Phase 8. **Done.**
7. Internationalisation: `translate()` is currently called during render, so
   React re-renders on language change for free. Replace it with an explicit pass
   that re-applies strings to labelled nodes on `changeLang`. This is the one
   capability being hand-written rather than deleted. **Dropped**, by Phase 1
   rather than here: `translate(lang, key)` and the two locale tables became one
   English `src/strings.ts`, and there is no `changeLang` to re-apply anything
   on. A widget reads the string it needs directly.
8. Finish the framework cutover. The second entry point, `react-konva`, Konva,
   `react-container-dimensions`, `react-numeric-input` and `rc-slider` are
   already gone. Remove `react`, `react-dom`, `react-bootstrap`, `react-select`,
   `react-download-link`, `enzyme`, `enzyme-adapter-react-16`,
   `react-test-renderer`, the `@types/react*` packages, `@babel/preset-react`,
   and `jsx` from the TypeScript configuration after the remaining shell is
   replaced. **Done**, and with them Bootstrap 3, jQuery, popper.js and the
   `$`/`jQuery` `ProvidePlugin` globals they needed, plus two dependencies that
   earlier phases had already stopped using (`happypack`, `@babel/polyfill`).
   `@babel/runtime` had to be declared: `@babel/plugin-transform-runtime` emits
   imports for it, and it had only ever been present as a transitive dependency
   of the React packages.

Exit criterion: the Phase 0 checklist passes with no React in the dependency
tree. Met. Checked in Chrome against a production build served over http:
loading the editor, running the sample to EOF with the expected stdout, setting
a breakpoint from the gutter and running to it, stepping back, the read-only
document during a session and its release on stop, the instructions dialog, the
theme switch reaching the editor, the console and the panels, and the upload
panel's list. `test/controls.test.ts`, `test/files.test.ts` and
`test/shell.test.ts` cover the new widgets; `test/App.test.tsx`, the Enzyme
smoke render, is gone.

## Phase 10: instance scoping

**Status: complete.** There is no module-level state left above the interpreter:
the bus and the interpreter client are constructed by the instance that uses
them, and `new Plivet(element, options)` is the only thing a host page needs.

The split the entry point makes is the one the Sphinx extension will use.
`src/index.ts` is the public surface - the class and its options, and nothing
with a side effect - while `src/main.ts` is the standalone page's own use of it
and is what `index.html` loads. `src/app/PlivetApp.ts` became
`src/app/Plivet.ts` in the move.

1. `emitter.ts` becomes a class. Each PLIVET instance constructs its own bus and
   passes it to its components. The typed event union stays; it is the registry.
   **Done.** `Bus` holds the subscriptions, `signal` and `slot` are its methods,
   and `destroy()` drops every listener at once. Two things left with the module
   scope: `setMaxListeners(20)`, which was only ever needed because every
   instance's subscriptions landed on one emitter, and the `events` polyfill -
   a browser-only widget has no reason to ship Node's `EventEmitter` to say
   `on` and `emit`, so `events` and `@types/events` are out of `package.json`.
2. The Worker client is per instance. Two instances on one page must not share
   interpreter state, history or uploaded files. **Done.** The `server` singleton
   at the foot of `src/core/client.ts` is gone; `Plivet` constructs an
   `InterpreterClient`, hands it to `EditorController`, and uploads through it.
   Each client owns a Worker and each Worker its own `Server`, so the
   interpreter, the history and the file map are per instance already.
   `destroy()` terminates the Worker rather than asking it to stop - a run is a
   loop on that thread - and drops the commands still in flight rather than
   failing them, because a rejection would reach the `alert` in
   `EditorController` after the reader has closed the thing that would show it.
3. Export `new Plivet(element, options)` as the only public entry. `index.html`
   constructs one. **Done**, with two options: `sourceCode`, the program the
   editor opens with, and `theme`. `index.html` is unchanged - it is
   `src/main.ts` that constructs the instance into `#root`.
4. Add a development page containing two instances side by side and confirm they
   do not interfere: stepping one must not move the other. **Done.**
   `src/dev.ts` and `src/dev.html`, added by `webpack.config.dev.js` only, so
   `npm run build` still ships one page. The two open with different programs
   and different themes, and both are on `window.plivet` so `destroy()` can be
   exercised from the console. The comment at the top of `src/dev.ts` lists what
   to try and what each thing checks.

Exit criterion: two independent instances run on one page. Met, and checked in
Chrome against the dev page: stepping A three times left B at `Stop`; starting
and stepping B left A on step 3; running A to EOF printed only A's output and
moved nothing in B; stopping A left B debugging and steppable; a theme chosen in
one stayed in one, in both directions; A blocked in `scanf` while B stepped, and
the line typed into A's console was read by A and left B's transcript empty; and
destroying A left B running. `test/bus.test.ts`, `test/client.test.ts` - which
stands a fake Worker in for the real one - and `test/instances.test.ts` cover
what does not need a browser.

## Phase 11: tests, CI and maintenance

**Status: complete.** Twenty-three Jest suites and 371 tests cover the portable
core, the debug extensions, the tooltips, the console, the control bar, the
shell, the upload panel, the `DEBUG_STATE` enablement mapping, the bus, the
interpreter client, two instances on one page, the preprocessor and the
interpreter end to end - and, since this phase, the whole application at once.
CI runs `npm ci`, lint, typecheck, test and build on the pinned Node, and
repeats all of it on the next major as an advisory job. `npm audit` reports
nothing.

1. Upgrade Jest and its TypeScript support as a compatible set, moving the
   deprecated ts-jest `globals` configuration into `transform`. **Done.** Enzyme
   and the React 16 adapter were dropped with the React shell in Phase 9;
   without React there was no component-testing library to choose, and the
   widgets are tested through the DOM they build.
2. Unit-test `src/core/` directly: `extractModel` against recorded `ExecState`
   fixtures, `layout` geometry, the breakpoint line-number conversion, the
   `DEBUG_STATE` to enablement mapping, and history replay for step-back.
   **Done**, in the phases that wrote the code: `core.test.ts` runs a real
   interpreter and checks `extractModel`, `layout`, the fold state and step
   history, including a session that steps back through a run longer than the
   history holds; `graph-geometry.test.ts` covers the geometry the paper is
   given; `editor-extensions.test.ts` covers the line-number conversion in both
   directions; `ctrl-buttons.test.ts` covers the enablement mapping for all six
   buttons in every state.
3. Test the debug extension array against a headless `EditorView`.
   **Done**, also earlier: `editor-extensions.test.ts` builds real
   `EditorState`s and views for the breakpoint field, the diagnostics, the
   preprocessor marks, the step highlight, and `attachDebugExtensions` against
   a view somebody else built.
4. Keep a small DOM-level smoke test that constructs a `Plivet` instance and
   steps once. **Done.** `test/smoke.test.ts` builds one into a `div` and
   presses the buttons a reader presses: the arrow to start and step, the
   double arrow to run to EOF, the square to stop. Behind it is the real
   `Server` on this thread - `spawnWorker` is mocked with a Worker-shaped
   object rather than the interpreter being faked - so a step has to reach the
   counter, the console and the canvas, and the document has to lock and
   release with the session. It is the only test that would notice a signal
   nobody carries any more.
5. CI runs `npm ci`, lint, typecheck, test and build on the pinned Node and npm
   baseline. **Done**, in that order: lint and types fail fastest and read
   clearest, the build is the slowest and last. The build step's absence was a
   webpack 4 limitation Phase 3 removed; the comment saying so is gone with it.
6. Add a second, non-blocking CI job for the next supported Node major so future
   runtime problems are visible early. **Done.** The same five steps run again
   on Node 26 under `continue-on-error`, so a failure there is a warning rather
   than a merge block.
7. Configure dependency updates in small groups: build tooling, tests, editor and
   graph libraries, interpreter dependencies. `unicoen.ts` is frozen upstream and
   should be excluded from automated updates. **Done.** `renovate.json` groups
   build tooling, test tooling, lint and format, `@codemirror/*`, JointJS and
   the runtime support packages, each with the reason it is a group - a loader
   ahead of its webpack, ts-jest ahead of its Jest, typescript-eslint behind
   either of the two it tracks. `unicoen.ts` is disabled outright: PLIVET's
   interpreter is a subclass of it. Patch and minor updates automerge on a
   green CI that now checks five things rather than one; majors and the
   `engines` baseline do not.
8. Run `npm audit` and review findings manually. Do not use forceful automatic
   upgrades that can cross major versions without tests. **Done**, and what it
   found was a lockfile holding transitive dependencies older than the ranges
   their parents allow: thirteen advisories, two of them critical, every one of
   them in development dependencies. `npm install` does not move a lockfile
   that already satisfies the ranges, and `npm audit fix` had nothing to
   propose that it would; `npm update` refreshed them inside those same ranges
   and nine of the thirteen went with it. `@babel/core` was pinned
   below its fix and moved to 7.28.5 -> 7.29.7. The last three were one
   advisory - `uuid` under `sockjs` under `webpack-dev-server` - reachable only
   by crossing a major, so it was crossed by hand rather than by
   `npm audit fix --force`: webpack-dev-server 6 wants the webpack and Node
   this project already has, and the dev server was started against both pages
   to check it. `npm audit` reports nothing now.

Maintenance done with them: `.travis.yml` was still in the tree, asking for
Node 10 on a distribution Travis retired, and the README still carried its
build badge. Both are gone, and the badge points at the workflow that actually
runs.

Exit criterion: the Phase 0 checklist is covered by automated tests wherever it
can be, and CI is green from a clean dependency cache. Met - `npm ci` from an
empty cache, then lint, typecheck, 23 suites and 371 tests, and a production
build, all green, with the parts the checklist has that jsdom cannot hold - the
canvas, the Worker, the browser - checked in Chrome at the end of Phases 8, 9
and 10.

## Phase 12: teaching features

**Status: items 1 to 19 done.** Items 1 to 4 are the phase proper; the rest are
independent of it and of each other, and can be taken in any order or dropped.

Everything before this phase is parity work: the same application on a stack
that is still supported. This phase is what the new stack was worth changing
for. It begins only once the acceptance checklist passes, so that no feature
here can be confused with a migration regression.

Two rules bound the whole phase:

- **The Phase 7 package budget holds.** Anything shipping inside the debug
  extension array may use only `@codemirror/state`, `view`, `language`,
  `commands`, `autocomplete` and `@codemirror/lint` - the packages an
  interactive-code page already loads. A feature needing a new package
  (`@codemirror/search`, `@codemirror/merge`) belongs to `PlivetEditor` alone,
  or is bundled into PLIVET's own chunk and paid for in bundle size. Decide
  which side of that line an item falls on before building it.
- **Constraint 6 holds.** A feature that needs runtime facts needs them as
  plain data in `StepModel`. Nothing reaches back into an interpreter object
  from the main thread because a decoration wanted a value.

Items 1 to 4 are the phase. The rest are independent of each other and of
it, and can be taken in any order or dropped.

1. **Inline values.** **Done.** An end-of-line `WidgetType` under the current
   step showing what the variables in that statement now hold, dispatched on
   the same effect as the step highlight in `src/ui/editor/stepHighlight.ts`.
   This is the largest single teaching gain available: it removes the mental
   step of mapping the graph back onto the line being executed. Restrict it to
   the variables the current statement reads or assigns; a whole frame rendered
   per line is noise. `StepModel` grows a per-step list of `{ name, display }`.

   The effect now carries a `StepMark` - the range and the values together -
   which two fields read: `stepHighlightField` for the marker and
   `inlineValueField` for the widget. They travel as one because they are one
   fact about one step, and nothing can put the marker on one line and the
   values of another. `statementNames` in `src/interpreter/StatementNames.ts`
   walks the statement about to run for the names it mentions, in source order,
   and `extractModel` keeps the ones an object in scope answers to - so a call
   to `printf` reports its arguments and not itself. Six is the most a line
   gets; past that the canvas is the thing that shows a frame.

2. **A teaching linter.** **Done.** `src/ui/editor/diagnostics.ts` maps `SyntaxErrorData`
   and nothing else, yet a `@codemirror/lint` diagnostic also carries
   `severity`, `actions` - one-click fixes - and `renderMessage` for structured
   DOM. Add the static checks that `Construct.ts` and `RuntimeTypeInfo.ts`
   already have the information for: `scanf` missing the `&`, an assignment
   used as a condition, a format specifier disagreeing with its argument, a
   variable read before it is initialised, a non-`void` function that can fall
   off its end. Attach a fix action only where the fix is unambiguous, and link
   the message into `libraryHelp` where an entry exists. Add `lintGutter()` so
   a warning is visible without hovering for it. Write the rules as a table
   walked by one pass, not a pass per rule; the value of this item is that a
   teacher can add the next rule cheaply. Where PLIVET is embedded and a host
   toolchain is reachable, real compiler warnings can arrive from it instead of
   being reimplemented here; see Phase 13.

   `src/interpreter/TeachingLint.ts` holds the table and the one walk over it.
   A rule is `{ name, severity, enter, leave }`; the walk keeps the scope, so a
   rule asks what a name was declared as rather than finding out for itself.
   The five are there - `scanf` without an address, an assignment used as a
   condition, a format string disagreeing with its arguments, a read before a
   value arrives, and a function that can reach its end without returning - and
   the two severities are a distinction rather than a mood: `error` is for what
   C leaves undefined, `warning` for legal C that is nearly always a mistake.
   Where a rule cannot tell - a `switch` whose cases fall into each other - it
   says nothing, because a lesson a reader can see is wrong teaches worse than
   no lesson at all. Fixes are offered as an offset from the finding, so an
   edit above one moves the fix with it, and only where the text at that range
   in the reader's own file is still what the rule thinks it is: the tree is
   parsed from a rewritten source, and the two agree on lines but not always on
   columns. `lintGutter()` is in the debug array, and the library entry a
   message points at is looked up by the application and formatted by the
   editor - `libraryHelp` stays the one place that knows what `scanf` is.

3. **Runtime diagnostics.** **Done.** The same lint API, raised at the step that goes
   wrong rather than after the run: division by zero, an index past the end of
   an array, a dereference of a pointer with no target, a read of uninitialised
   memory. The interpreter detects most of these already and reports them as
   console text, which is why they teach so little. PLIVET's own refusals -
   `PlivetCPP14Engine.refuse` - already name the line they stopped on in that
   text, so what is left here is the surface rather than the position: raise
   them through the lint API and carry the position through the Worker
   alongside the message. Cleared on restart, like every other debug
   decoration.

   `refuse` now records what it refused before it throws, and `warn` beside it
   records what C leaves undefined but does not stop for. Four checks went in
   with the surface: division and remainder by zero, an index outside an array
   whose length the declaration gives, a dereference or subscript of a pointer
   that points at nothing, and a read of a local nothing has written. The last
   is the only warning - reading uninitialized memory is not something C stops
   for, and ending the run over it would teach that it does - and it is said
   once per object however often the read happens. A local enters that set only
   where the source is certain, a declaration with nothing after the name, and
   leaves it on the first assignment or the first time its address is taken, so
   a parameter, a global and anything `scanf` was pointed at are never in it.
   The list rides every response, because the linter holds one set and a
   session shows one response at a time; a stopped session sends an empty one,
   which is what takes the marks off. `RuntimeDiagnostic` is the interpreter's
   own coordinates - the end column names the last character - and the
   application makes it exclusive on the way into the linter, the same
   conversion the step highlight makes.

4. **A tooltip for every construct, not only for declarations.** **Done.**
   `constructText` in `src/components/hoverText.ts` formats five kinds richly -
   `variableDec`, `typeDec`, `enumerator`, `recordField`, `functionDec` - and
   every other kind falls through to its label and a detail string that
   `detailOf` in `src/interpreter/outline.ts:149` returns empty for. Hovering an
   `if` says "if statement", which the reader could already see. Control flow is
   where a beginner's model of C actually breaks, so it is the wrong half of the
   language to leave unexplained. Each kind gets what a reader cannot recover by
   looking:
   - **Function definition.** Beyond the current return type, identifier and
     parameters: definition or declaration, storage class, and while stepping
     the current activation - the arguments it was called with, and how many
     times it has been entered.
   - **Function call.** The callee's declared signature, arguments paired with
     the parameters they initialise, the values passed at this step, and the
     value returned once it returns. C passes by value and nothing on screen
     says so today; this is the single most reliable beginner misconception.
   - **`if`.** The controlling expression, the integer it evaluated to at this
     step, and which branch was taken. C has no boolean type, so show the value
     and the zero / nonzero reading of it rather than `true`.
   - **`for`.** The three clauses named as the standard names them -
     initialisation, controlling expression, iteration expression - the loop
     variables as they stand, and the iteration count so far.
   - **`while` and `do`-`while`.** The controlling expression, its current
     value, the iteration count, and for `do`-`while` the fact that the body ran
     before the first test.
   - **`switch`.** The controlling expression's value, the label selected, and
     whether control falls into the next label. Fall-through is invisible in the
     source and is the classic trap.
   - **`return`.** The expression, the value it yields here, and the function it
     leaves.
   - **`break` and `continue`.** Which enclosing loop or `switch` it leaves or
     restarts. A `break` inside a `switch` inside a loop is ambiguous to a
     reader and unambiguous to the parser.
   - **Assignment.** The object assigned, its value before and after, and any
     conversion the assignment itself performs - the truncation in
     `int i = 2.7` is done by the assignment, not by the literal.
   - **Cast and conditional expression.** For a cast, the source and destination
     types and whether the conversion can lose information; for `?:`, the arm
     chosen and the common type the two arms are brought to.
   - **Subexpressions.** Hovering inside a compound expression reports the
     innermost subexpression under the pointer, its type and its current value,
     from the same evaluation data Phase 8 item 6 renders on the canvas. One
     source of truth, three presentations: the hover, the canvas expansion, and
     the statement explanation of item 13.
   - **Preprocessor.** The existing macro tooltip reports one replacement step;
     report the full expansion of a macro defined in terms of other macros, so a
     nested definition does not have to be unfolded by hand.

   Three things this needs. The static half is `outline.ts` recording the
   clauses and the enclosing loop or `switch` for each construct - today
   `constructAt` deliberately knows nothing about enclosure, which is right for
   choosing a construct and insufficient for describing one. The runtime half is
   `StepModel` carrying per-construct evaluation results, the same data items 1
   and 3 need, so build it once. And a tooltip shows a runtime line only when
   the step it belongs to is the current one; the static description always
   stands on its own, and a stopped session shows no values rather than the last
   run's.

   The static half is in `outline.ts`: `Construct` grew `clauses`, taken from
   the source the reader wrote rather than the tree printed back; `enclosing`,
   which is the loop a `continue` restarts and the `switch` a `break` leaves
   even when a loop is nearer; `notes`, for what is true however the construct
   runs, such as a `do`-`while` body running before its first test; and, on
   `FunctionDeclarationDetail`, whether the declaration has a body and which
   specifiers stand in front of the return type without being part of it. A
   call's arguments are written beside the parameters they initialise, which is
   the shortest way to say that C passes by value.

   The runtime half is `src/interpreter/ConstructTrace.ts`, driven by the
   engine the way `ExpressionTrace.ts` is, and it leaves plain data on the
   `ExecState`. The engine wraps `execIf`, `execFor`, `execWhile` and
   `execSwitch` to say what has been entered, and reports every evaluation
   through `execExpr`; an index built once from the tree turns a node into the
   construct that was interested in it, so nothing has to know the shape of the
   forty-odd node classes twice. Two decisions carry the item. A value is
   spelled the way C leaves it - the engine compares with JavaScript's
   operators and hands back a boolean, and a reader told that `i < 3` is `true`
   has learned the wrong language - and the zero/nonzero reading is offered
   only where the value decides something, never for a `switch`, which selects
   on a value rather than on whether it is zero. And a fact belongs to a step
   in one of two ways: a construct the step is _inside_ is live and its
   counters go on climbing, while a construct that _just finished_ - the call
   that returned, the assignment that landed - is kept for exactly the one stop
   that follows, because there is no stop at which a `return` has produced its
   value and the statement is still the current one. Both are cleared at every
   stop, so a stopped session says nothing.

   Two things came out differently from the sketch above. Subexpressions do not
   read the tree Phase 8 renders: that tree carries the statement _about to_
   run, so its operators have no values yet and never do in a snapshot the
   reader sees. `StepModel.evaluations` records what the operators of the
   statement just finished came to, by range, and the tooltip takes the
   smallest range covering the pointer - the same rule `constructAt` uses one
   level up. It reports the subexpression and its value, and not its type:
   `Engine.getType` answers for names, `*`, `[]` and `.` and nothing else, and
   a type invented for `a * b` would be a lesson a reader could see was wrong.
   The other is the preprocessor: `Expansion.text` was already the full
   expansion rather than one step, so what was missing was the middle -
   `replacement` records the macro's own replacement list where it differs, and
   the tooltip reads `NEXT → STEP → 3`.

5. **Completion from the program's own symbols.** **Done.** `completeAnyWord` in
   `PlivetEditor.ts` was a placeholder that completed any word in the buffer,
   including misspellings. It is replaced by a `CompletionSource` over the
   syntax tree and `Construct.ts`: variables in scope with their types, struct
   and union members after `.` and `->`, and the `libraryHelp` names with
   `Completion.info` rendering the signature and description into the side
   panel. The reference material is reachable while typing instead of only on
   hover.

   `ProgramCompletions` in `src/ui/editor/completion.ts` holds the constructs
   of the last syntax check - the same ones the tooltip reads, so nothing here
   parses anything - and the syntax tree is asked one question, which is a
   question about text rather than about C: whether the cursor is inside a
   comment or a string, where a suggestion interrupts rather than offers.
   Scope is read as C reads it, a name after its declaration and a local
   inside its own function, and deliberately no narrower: the constructs
   record where a declaration is, not where its block ends, and offering a
   name one block too widely is a smaller wrong answer than hiding one the
   reader can see on the screen. A member list is offered only where the name
   in front of the `.` resolves to a record - through a pointer, and through
   however many typedefs stand between the reader's spelling and the tag the
   members are recorded under - because a list of every member of every
   structure would be a guess wearing the clothes of an answer. Leaving the
   source out turns completion off rather than falling back to the buffer's
   own words; the library arrives from the application, so `libraryHelp` stays
   the one place that knows what `printf` is.

6. **Snippets.** **Done.** `snippetCompletion` skeletons for `for`, `while`,
   `switch`, `struct`, `printf` and `scanf`, with tab-through fields. Beginners
   spend a disproportionate share of their time on C's punctuation. The snippet
   shows the syntax rather than hiding it, which is the difference between this
   and a block editor.

   `src/ui/editor/snippets.ts` holds the six, and they arrive through the same
   completion source item 5 built, above the names in scope: a reader who has
   typed `for` wants the loop rather than a variable beginning with those
   letters. Two things the templates lean on. A field written twice under one
   name is one field, so the counter of a `for` is declared, tested and
   incremented by a single tab stop - which is the fact about a `for` that is
   worth teaching. And a leading tab in a template is one level of
   indentation, expanded to whatever the editor indents with, so the result
   matches the file it lands in. Where a snippet and a library function are
   the same word, one entry is offered rather than two, and it is the template
   carrying `libraryHelp`'s own signature and sentence.

7. **Structured hover, and cross-highlighting with the graph.** **Done.**
   `src/ui/editor/tooltip.ts` set `textContent`; `create()` may return any DOM.
   It now renders type, address and current value as a small table, and the
   matching row is selected in the JointJS paper while the tooltip is open.
   Then the reverse: hovering a row in the graph marks the declaration in the
   editor. This is the point at which the two panes stop being separate
   pictures of the same program. `hoverText.ts` returns records rather than
   assembled lines; it is already the only place that knows the facts, and
   formatting is the tooltip's business. Item 13 reads those same records, so
   the record is the interface both surfaces are written against.

   What makes the link is one key. A cell key names a cell, and an object is a
   row of them, so `CellModel.object` carries the key every cell of one
   variable's row shares and `VariableModel.key` carries the same one - two
   passes over the same stacks that have to agree about exactly one thing.
   From there it is only carriage: `layoutMemory` puts the key on the row,
   `MemoryNode` writes it onto the boxes as `data-object-key`, and the paper's
   own hover reads it back off the DOM, because what a reader points at is one
   row of a segment and the paper would report the node. The mark itself is a
   class rather than an attribute - JointJS writes fill and stroke as
   presentation attributes, which a stylesheet outranks - and it is put back
   after every render, since a reader holding the pointer over a row while the
   program steps is still pointing at it. Across the bus it is one event
   carrying the object and which panel it came from, so a side ignores what it
   said itself. The editor's end is a second decoration rather than a reuse of
   the step marker: one says where execution stands and one says where the
   reader is looking, and neither can take the other's place. And it does not
   scroll - the reader is looking at the canvas, and a page that moved under a
   pointer they are not pointing with would be the editor answering a question
   nobody asked.

8. **Pinned watches.** **Done.** A `showTooltip` `StateField` holding tooltips
   the reader pinned to a variable, updated on every step. A watch window with
   no new user interface.

   `src/ui/editor/watches.ts` holds the field and the gesture. The values a
   debugger's watch pane shows are already in the document, beside the names
   they belong to, and a pane on the far side of the editor asks the reader to
   hold a second copy of the program in their head to use it - so a pinned
   tooltip stays where the name is written and says what it says there. The
   gesture is alt-click rather than a plain click, because a plain click is
   how a reader moves the cursor and a watch pinned by every cursor move is
   not a watch window but a mess. A watch is pinned to a place in the text: an
   edit above it moves it, and an edit that deletes the name takes the watch
   with it rather than leaving a value floating over whatever moved into that
   position. Which names are pinned is the editor's - they are positions in
   its document - and what a name is worth is the application's, so the
   records are pushed in at every step rather than looked up by the editor;
   they are the same records item 7 built, so a watch and a hover of the same
   name cannot disagree. A pinned name the current frame has no object for
   says so instead of vanishing, which is a lesson about scope rather than a
   pin that seems to have come loose.

9. **Editor affordances**, worth one pull request together. **Done.**
   `highlightSelectionMatches` lights up every occurrence of the identifier
   under the cursor (`@codemirror/search`, so standalone only); `foldGutter`
   plus a fold service folds function bodies and the `#if 0` regions already
   tracked as `Expansion`s; a coverage gutter using `gutterLineClass` shades
   lines by execution count, which makes loop behaviour and dead branches
   visible at a glance; `selectParentSyntax` sits on Mod-i, which is a direct
   lesson in nesting; `EditorView.announce` fires per step so a screen reader
   follows the run; and the pieces missing from `PlivetEditor`'s extension
   list are there - `drawSelection`, `dropCursor`, `rectangularSelection`,
   `placeholder` and `highlightSpecialChars`, the last of which turns a pasted
   non-breaking space from a mystery into a visible character.

   Two of them needed a decision rather than a line. The counting is the
   interpreter's, in `Server`, not the editor's: a run reports two responses
   and takes thousands of steps between them, so anything counted on this side
   would be a count of what the reader happened to be shown. It is four bands
   rather than a gradient, because the questions a gutter is asked are whether
   a line ran, whether it ran often and whether it ran far more often than its
   neighbours - not what the exact count was. And the fold service answers for
   the first line of a run of excluded lines only, since a service that
   answered for every line of the run would offer a fold on each of them;
   function bodies need no service at all, because `lang-cpp` already marks
   their blocks. What the announcement says is the statement and what its
   variables hold - the same values item 1 prints at the end of the line -
   because that is what a reader who cannot see the marker would otherwise
   hover every name on the line to learn.

10. **Protected regions.** **Done.** A `transactionFilter` rejecting edits
    outside marked spans turns a program into a fill-in-the-blank exercise,
    which is the shape an A+ task usually takes. No new package, and it
    composes with the read-only compartment in `debugExtensions.ts` rather than
    competing with it: read-only is the debugger holding the document while a
    program runs and is about time, this is about place, and a running session
    freezes the blanks along with everything else.

    The regions arrive through `PlivetOptions.editableRegions` and are empty by
    default, so the feature costs nothing until a page asks for it - PLIVET
    standalone is a file with no regions, editable everywhere. A blank grows
    with what is typed into it, its start holding against text inserted there
    and its end giving way, so an edit at either edge lands inside rather than
    pushing the region off the text it was drawn around. A refused transaction
    is dropped whole rather than stripped of its changes, because the selection
    it carries was worked out against the document the edit would have made.
    The one change that always goes through is the application replacing the
    program: a host handing PLIVET a new file is not a student typing outside
    the blank, and it says so with an annotation rather than by turning the
    filter off.

11. **The preprocessed source, side by side.** **Done.** `@codemirror/merge`
    against the output of `src/interpreter/preprocess.ts`, showing what
    `#define` and `#if` actually did. The merge view is a second editor, so it
    is not part of the debug array and does not travel to a host page.

    It answers the question the hover cannot. The editor marks each
    replacement and says what it became, one at a time; an absence has nothing
    to hover, so the only way to read what a conditional kept out is to see
    the two texts beside each other. Both halves are read-only - neither is
    the document being edited: the left is a copy of it and the right is the
    compiler's own input, which nobody types - and the comparison is rebuilt
    at every opening, because the source changes while the dialog is closed
    and a merge view holding a stale half is worse than none. The dialog and
    the preprocessor arrive together in a chunk of their own, so a reader who
    never asks what the preprocessor did never downloads the answer.

12. **Session serialisation.** **Done.** `EditorState.toJSON`, plus the
    breakpoint set and the pinned names, so a session can be saved, handed in,
    or opened by a teacher looking at where a student had got to.

    `Plivet.session()` writes one and `Plivet.restoreSession()` reads one back,
    both over plain JSON. The run is deliberately not in it: a session
    restores the program and what the reader marked on it, and then the
    program is run again from the start, because a replayed run has to be a
    run of this interpreter over this source rather than a recording somebody
    could have edited. The document is replaced rather than the view rebuilt -
    the debug extensions are configured into that view - and the replacement
    goes in as the application's own, so a protected-region exercise can still
    be restored into its blanks. What arrives from outside is checked rather
    than trusted, since it may be another version's, another tool's, or half
    of one.

13. **One explanation of the current statement.** **Done.** A teaching view that says
    what the statement under the step marker does, and it is the general case
    that the expression expansion of Phase 8 item 6 sits inside rather than a
    view beside it. The expansion draws the operands, the operators, the
    evaluation order and the intermediate values; the explanation puts that
    picture under a reading of the whole statement - which kind of statement it
    is, which branch or which iteration this is, what it leaves behind when it
    finishes - so the expression window beneath the memory map is this view's
    picture, and switching the explanation off takes the expansion with it.

    Its content is item 4's tooltip data read as a whole rather than one hover
    at a time: the construct record for the statement, and the subexpression
    records for the expressions inside it. Nothing here computes a second
    description of a construct. If the explanation wants a line the tooltip does
    not have, the line is added to the construct record in `outline.ts` or to the
    per-construct evaluation results in `StepModel`, and both surfaces gain it -
    which is why this item follows item 4 for the facts and item 7 for their
    shape, since item 7 is what turns `hoverText.ts` from assembled lines into
    the records this view reads.

    `HoverTextSource.explainStatement` gathers them and the records themselves
    moved to `src/ui/records.ts`, because a widget that imported the other
    widget could not be lifted out on its own and this is the one thing the
    tooltip and the canvas have to agree about. The source text is handed in:
    the values are recorded by range, and what an operator came to means
    nothing without the operator, which only the text the reader wrote can
    say. Two rules decide what is printed. The parts are printed only where
    there is no expansion to draw - when there is one, the tree says what each
    operator came to, and saying it twice on one screen is noise rather than
    emphasis. And the section is one switch rather than two: the reading and
    the picture are one view of one step, so the box that takes the
    explanation away takes the expansion with it. A step whose records have
    not arrived falls back to the summary the geometry works out on its own,
    so the heading always has something under it.

14. **A view of the call stack.** **Done.** `CallStackView` under the canvas,
    innermost frame first: the function, the line the call is written on, the
    arguments it was passed beside the parameters they filled, and how many
    times the run has entered it. The memory map already draws the frames as
    bands of storage, and that is a different question - a frame there is an
    address and the objects in it, and here it is a call. The arguments are
    what earn the view its place: C passes by value, nothing else on the
    screen says so, and a frame showing `n = 1` beside the call that wrote
    `twice(total)` is that rule said once per call. The data is
    `StepModel.frames`, built by `ConstructTrace` from the activations it
    already keeps, so nothing walks the interpreter's objects from outside.
15. **A view of what the run has written.** **Done.** `MutationView`, newest
    write first: the frame it happened in, the object as the source names it,
    what it held before, what it holds after, and the line. Every other view
    says what memory holds now; this says what it held before, which is the
    question a reader asks when a value is wrong and they are looking for the
    statement that made it wrong. The frame column is why it is a view rather
    than a column somewhere else: a write inside a callee is a write to the
    callee's own copy, and naming the frame shows the by-value rule happening
    instead of asserting it. The log lives in the recorder, bounded at 500
    writes, and rides every state by reference with the length it had at that
    step beside it - so attaching it costs a step nothing, and stepping back
    shows the log as it stood rather than a future the reader has not reached.
16. **A control panel for the views.** **Done.** The switches sit in the strip
    that holds the panes, above them: the canvas's own disclosure decides what
    the canvas draws, and a control that turned off a pane somewhere else on
    the page would be one a reader has to go looking for. Both panes start
    off - a view worth having is not worth having by default, and the two
    columns a reader opens PLIVET for are the editor and the map - and a pane
    that is off is filled with nothing as well as hidden, so a run of a
    hundred thousand writes costs a reader who is not looking at them no rows
    at all. Closed, the whole strip is one line of switches.
17. **Open a program, save a program.** **Done.** Two buttons on the control
    bar. Saving writes the editor's text out as a C file, named after whatever
    was opened so that saving what you opened gives back a file of the same
    name; opening reads a file and puts it in the editor, stopping the session
    first - the document is held while a program runs - and checking it
    afterwards, so the marks belong to the program now in it. The picker is
    the browser's own and cannot be opened without an input, so the bar keeps
    a hidden one behind a button of its own shape rather than putting a
    platform-drawn control in the row. What a file is, is decided by reading
    it rather than by its name: a session from item 12 is JSON and a C program
    is not, so opening either works and a reader who renamed one still gets
    what is in it. A JSON file this version cannot read is refused with a
    sentence rather than dropped into the editor as text.
18. **Several files open at once.** **Done.** A strip of tabs over the editor,
    one per open file, with the translation unit marked: C compiles one, and
    PLIVET's preprocessor discards `#include`, so exactly one of them runs and
    pressing another file's marker makes that one the entry instead. This is
    the shape the interactive-code directive already has - the parts of a
    block are tabs, one of them is the main file, all of them are submitted -
    which is why constraint 7 asked for it, and the Worker protocol now
    carries `files` and `entry` beside `sourcecode` rather than a string
    alone.

    A tab is not only a text. Switching away keeps the whole session of the
    file being left - the cursor, the breakpoints, the pinned names, using
    item 12's own record - and switching back puts it in place, because a tab
    a reader has to find their place in twice is a worse way to hold a second
    file than a second window. The entry runs whichever tab is on the screen,
    and while the reader is looking at another file the parser's marks come
    off rather than land on lines they are not about. The file that runs
    cannot be closed, and with one file open the strip is not drawn at all, so
    the ordinary case looks exactly as it did before tabs existed.

19. **Linker diagnostics.** **Done.** `src/interpreter/LinkerCheck.ts` walks the
    translation unit once and reports the failures that parsing and statement
    lint cannot: a second function or initialized file-scope object definition,
    a called prototype with no definition, and a program with no defined
    `main`. The checks deliberately leave an undeclared call alone because it
    may name a library function, and distinguish initialized definitions from
    C's compatible tentative definitions and `extern` declarations. Findings
    share the teaching-lint surface, so the editor displays compiler and linker
    explanations in one place.

Exit criterion: each item lands as its own pull request, behind no flag; the
debug extension array still attaches to an `EditorView` somebody else built;
and the Phase 0 checklist still passes.

## Phase 13: deferred to the extension

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
- Multi-file interpretation: resolving `#include` between the block's own files,
  honouring the entry file the directive names, and mapping steps, breakpoints
  and diagnostics back to the tab a line belongs to. Constraint 7 lands the
  protocol shape in Phases 6 and 7; only the interpreter work is deferred here.
  `unicoen.ts` parses one translation unit and will not be upgraded, so the
  likely shape is PLIVET splicing the files into one unit before parsing and
  keeping a line map back to the originals — a preprocessor pass, not a linker.
- Compiler diagnostics from the host rather than a second front-end in the
  browser. A+ already runs the student's code on a machine with a real
  toolchain, so `gcc -fsyntax-only -Wall -Wextra -fdiagnostics-format=json` is
  one endpoint away, and that JSON carries the line, the column, the ranges,
  the severity and the `-Wname` that produced it - everything a
  `@codemirror/lint` diagnostic wants, with no rules of our own to maintain.
  The alternative, clang compiled to WebAssembly, is tens of megabytes fetched
  into what is otherwise a static page: the Phase 12 package budget rules it
  out, and it would break the offline copy the README promises. Three things to
  settle when this is built. The request is debounced source over the network,
  so it is a privilege of the embedded mode alone - standalone PLIVET keeps
  whatever static rules Phase 12 item 2 gives it, and neither mode may block a
  run on an answer that may never arrive. gcc and `unicoen.ts` do not agree
  about what is legal, so the compiler's diagnostics merge with the
  interpreter's marked as the compiler's, never replacing them. And the source
  sent is the one the user typed, not the output of `preprocess.ts`: gcc has
  its own preprocessor, so the positions coming back need no correction.

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

1. Baseline, parity checklist and performance benchmark. **Done.**
2. Reduce scope to C; delete the Java and Python interpreters, samples and
   selector. **Done.**
3. npm conversion and lockfile migration. **Done.**
4. Webpack 5 and development server. **Done.**
5. TypeScript 5, ESLint and Prettier. **Done.**
6. Extract `src/core/`, split `CanvasDrawer`, define `StepModel`.
7. Bound `stateHistory`.
8. Worker client and Worker; `StepAll` without the timer.
9. CodeMirror editor. **Done.** It originally landed in place in `49cda77`; the
   temporary migration entry used for the renderer replacement is now gone.
10. Debug extensions: breakpoints, step highlight, diagnostics. **Done.**
11. JointJS graph, cut over to the primary entry. **Done.**
12. Redraw suspension. **Done; browser benchmark pending.**
13. Shell: layout, controls, console, files, switches. **Console done.**
14. Instance scoping and the `Plivet` entry point.
15. Delete the remaining React shell and dependencies. The old entry point is
    already gone.
16. Tests, CI and dependency-update automation.

Then Phase 12, once the acceptance checklist passes:

17. Inline value widgets under the current step. **Done.**
18. Teaching linter with quick fixes and a lint gutter. **Done.**
19. Runtime diagnostics carried from the Worker with their positions. **Done.**
20. Construct tooltips: the static half - clauses, enclosure, conversions.
21. Construct tooltips: the runtime half - conditions, iterations, arguments,
    returned values.
22. Symbol and library completion; snippets.
23. Structured hover and editor-to-graph cross-highlighting.
24. Editor affordances: occurrence highlight, folding, coverage gutter,
    accessibility announcements.

Items 8 to 12 of that phase are independent and taken only if wanted.

Each pull request must leave install, lint, typecheck, test and build green.
Phases 7 to 9 stay behind the second entry point precisely so that this holds.
Avoid combining the npm lockfile transition with any behavioural change.
