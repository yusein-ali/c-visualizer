# Phase 0 — baseline

Everything Phase 0 of [UPGRADE_PLAN.md](../UPGRADE_PLAN.md) asks for: the
toolchain result, the parity checklist, reference screenshots, and the
performance benchmark that Phases 5–8 are measured against.

Fill in [results/RESULTS.md](results/RESULTS.md) as you go. Nothing in this
directory is imported by `src/`; it is documentation plus two console scripts.

Run everything **before** Phase 1 deletes Java and Python. Nothing here needs a
local Node 16 install: section 1 is already captured, and sections 2–4 run in a
browser against the deployed bundle served from disk — see _Which build to
measure_ below.

---

## Which build to measure

Serve the deployed artifact from disk. The `gh-pages` branch **is** the
production build, so checking it out and serving the directory gives the exact
bytes that are deployed, with no dependency on GitHub Pages being enabled:

```bash
git checkout gh-pages
python3 -m http.server 8080 --bind 127.0.0.1   # http://localhost:8080
```

Two conditions on the result.

**The deployed bundle is current in the way that matters.** `gh-pages` (`ff91ce5`)
was built from `7045f42`, four commits behind `master` (`59febdf`). Those four
commits touch `package.json` and `yarn.lock` only — `@types/*` and Babel bumps.
`src/`, `test/` and every build config file are byte-identical:

```bash
git diff --stat 7045f42..master -- src test webpack.config.js webpack.config.dev.js babel.config.js tsconfig.prod.json
# empty
```

Record `7045f42` as the commit under test in `RESULTS.md`.

**Compare production against production.** This is a minified production build;
`yarn start` is an unminified dev build with source maps and HMR, and it is
materially slower. A Phase 6 number taken from a dev server against a Phase 0
number taken from here measures the build mode, not the migration. So benchmark
every later phase against a production build:

```bash
yarn build && npx serve dist    # npm run build from Phase 2 onwards
```

**A warning about this branch.** `baseline/` is untracked, so it survives the
checkout — but do not commit it while `gh-pages` is checked out, or the Phase 0
record lands on the deploy branch and is overwritten by the next deploy. Switch
back to a branch off `master` first:

```bash
git checkout cm6-jointjs-port    # baseline/ follows, still untracked
```

## 1. Bundle baseline

No local Node 16 build. The toolchain is replaced wholesale in Phases 2–4, so a
webpack 4 build log has no forward value; the one figure that does — what ships —
was read straight off the deployed branch into
[results/deployed-bundle.txt](results/deployed-bundle.txt):

| Asset                              | Bytes                   |
| ---------------------------------- | ----------------------- |
| `js/main.js`                       | 1,487,510               |
| `licenses.html`                    | 1,051,111               |
| `js/CPP14.bundle.js`               | 491,072                 |
| `js/Java8.bundle.js`               | 473,674                 |
| `js/CPP14-Java8-Python3.bundle.js` | 417,882                 |
| `js/Python3.bundle.js`             | 183,677                 |
| fonts (glyphicons ×5)              | 215,721                 |
| **total**                          | **4,320,799 (4.12 MB)** |

Two things this pins down:

- **Phase 1** deletes `Java8.bundle.js` and `Python3.bundle.js` outright (657 KB)
  and should collapse `CPP14-Java8-Python3.bundle.js` — the chunk webpack split
  out of the three interpreters' shared code — back into `CPP14`. Its exit
  criterion is checkable against this table without a Node 16 baseline.
- **`main.js` at 1.45 MB** is the React, Ace, Konva, Bootstrap and glyphicon
  payload that Phases 7–9 remove. The glyphicon fonts go with the Bootstrap
  removal in Phase 9, step 2.

Reproduce or refresh with:

```bash
git fetch origin gh-pages --depth=1 && git ls-tree -r -l FETCH_HEAD | sort -k4 -rn
```

Known state of `yarn test` and `yarn build` on Node 16 is deliberately not
recorded. If something looks broken during the migration and you need to know
whether it was broken before, the deployed site is the reference — it is a
working artifact of the pre-migration code.

## 2. Functional parity checklist

Walk `results/RESULTS.md` § _Parity checklist_ top to bottom in Chrome at
<http://localhost:8080>, with the console open, and record pass / fail / notes for each row. Any console error
counts as a note even when the feature works.

Order matters for a few rows: files must be uploaded before the sample program's
file-input section runs, and stdin only becomes typable once DebugStatus reads
`stdin`.

Reference points for the fiddly ones:

- **Breakpoints** — only clicks within 25 px of the gutter's left edge toggle
  one, and the editor must already have focus (`src/components/Editor.tsx:122`).
- **stdin** — the output pane is a second Ace editor. When DebugStatus reads
  `stdin`, type the value into it and press Enter; the trailing newline is what
  submits (`src/components/Console.tsx:41`).
- **Edit-during-debug** — modify the source mid-session and press Step: a modal
  with a "don't ask again" checkbox is expected. Phase 7 replaces this with a
  read-only document, so record the current behaviour precisely.
- **Programming-language switch** — Java and Python are removed in Phase 1.
  Record what they do today (including failures) so the removal is a deliberate
  scope cut rather than a silent regression.

## 3. Reference screenshots

### Set up once

The screenshots are compared against Phase 8's output pixel by eye, so the
viewport must be reproducible. Fix it before the first capture and record the
values in `RESULTS.md`:

1. Open <http://localhost:8080> in Chrome (see _Which build to measure_ for how
   the server is started).
2. Open DevTools (`Cmd+Opt+I`), toggle the device toolbar (`Cmd+Shift+M`),
   choose **Responsive** and type **1440 × 900**, DPR **2**, zoom **100%**.
3. Leave the theme on light and the UI language on English unless a fixture says
   otherwise.

### Per fixture

1. **Reload** (`Cmd+R`). This clears any previous session; do not skip it.
2. **Load the program.** From a terminal in the repo root:
   `pbcopy < baseline/programs/s1-pointers.c`. Then click into the editor,
   `Cmd+A`, `Cmd+V`. Pasting beats typing — no autocomplete or auto-pairing
   interferes.
3. **Wait about a second** and confirm no syntax-error marker appears in the
   gutter. A marker means the paste was mangled.
4. **Set the breakpoint.** Click once inside the code so the editor has focus —
   the handler ignores gutter clicks on an unfocused editor — then click the
   gutter on the target line **within 25 px of its left edge**
   (`src/components/Editor.tsx:122`). A marker appears. One breakpoint only.
5. **Run.** Press the sixth button in the first toolbar group (the double
   chevron, far right of that group).
6. **Wait until DebugStatus stops changing**, then read the step number — paste
   into the console:

   ```js
   document.body.innerText.match(/DebugStatus:.*/)[0];
   ```

   Record it in `RESULTS.md`. This number matters as much as the image: the same
   program and breakpoint must reach the same step after Phases 5–8, and a
   divergence is a regression that no pixel comparison would catch.

7. **Capture.** In DevTools press `Cmd+Shift+P`, type _screenshot_, choose
   **Capture full size screenshot**. It lands in `~/Downloads`; move it to
   `baseline/screenshots/` under the name in the table below. This captures the
   page itself, without window chrome or scrollbars, which is what makes two
   captures months apart comparable.

### Uninitialized memory is not reproducible

Cells that `malloc` allocates but the program never writes show whatever the
interpreter's memory model happens to hold, and the value **differs on every
run**. Two captures of S1 at the same step produced `Heap:20016 = 3788839368`
and `1483771526`.

This is not cosmetic: cell widths are computed from text length
(`alignToMaximumWidth` in `CanvasDrawer.ts`), so a 10-digit value against a
9-digit one shifts the table geometry — exactly what Phase 8 is meant to
reproduce. A comparison would show layout differences caused by nothing.

- **S1** was amended so every allocated cell is written (`rows[0][1]` and
  `rows[1][0]` were added on the existing lines, keeping the breakpoint on line
  23). Its GLOBAL frame now reads a fixed `10, 20, 30, 1, 2, 3, 4`.
- **S0 cannot be fixed** — it is the shipped sample and its value is that it is
  what ships. It never writes any allocated cell, so all seven GLOBAL rows are
  volatile. Compare S0 on structure only: frame count, row count, arrow
  topology, fold markers. Never on values or column widths.
- **S2, S3 and S4** allocate nothing and are strictly reproducible.

If the visualization is clipped by the canvas edge, do not fight it — note the
clipping in `RESULTS.md` and capture as-is. Phase 8 has to reproduce the same
view, and a scrolled or rescaled capture is not the same view.

### The fixtures

| Fixture | File                  | Breakpoint (editor line)         | Save as                                      | What it must show                                                                          |
| ------- | --------------------- | -------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| S0      | `s0-default-sample.c` | 28 (`printf("Hello,world!\n");`) | `s0-light.png`                               | the shipped sample: recursion, array, pointer, malloc, 2-D dynamic array                   |
| S1      | `s1-pointers.c`       | 23 (final `printf`)              | `s1-pointers-light.png`                      | pointer to local, pointer-to-pointer, pointer into an array, heap block, array of pointers |
| S2      | `s2-arrays.c`         | 16 (`printf`)                    | `s2-arrays-light.png`                        | 1-D array, 2-D array, char array                                                           |
| S3      | `s3-recursion.c`      | 8 (`printf("fact(%d)\n", n);`)   | `s3-recursion-light.png`                     | four nested `fact` frames plus `main` — the first hit is the deepest call                  |
| S4      | `s4-stdin.c`          | none                             | `s4-stdin-waiting.png`, `s4-stdin-light.png` | stdin handling — see below                                                                 |

### S4 in detail

Stopping at `scanf` is the fixture, not a failure. Execution parks there with
DebugStatus reading `stdin`, and the output pane — the Ace box directly below
the editor — becomes editable.

1. Run. DebugStatus reads **`stdin`**. Capture now as `s4-stdin-waiting.png`;
   this is the state Phase 9's console rewrite has to reproduce.
2. Click at the **end** of the console's existing text, type `3`, press
   **Enter**. The trailing newline is what submits
   (`src/components/Console.tsx:41`). Type at the end and nowhere else: the
   handler recovers your input by string-replacing the accumulated output out of
   the pane's full text, so editing mid-text can mangle it.
3. This performs exactly **one step**, not a resume. Press run again to continue
   to the second `scanf`.
4. Type `4`, Enter, press run again.
5. DebugStatus reaches `EOF` with `7` in the output pane. Capture as
   `s4-stdin-light.png`.

Record that type-then-run-again cycle in `RESULTS.md` as current behaviour.
Phase 6 moves stdin to a message across the Worker boundary, where turning it
into an auto-resume would be an easy accident and a silent behaviour change.

### The two zoom controls

They are unrelated, and different phases remove each. Capture both from the same
stopped-at-breakpoint S1 state — change the control, recapture, do not re-run.

- **`s1-pointers-scale.png`** — the canvas scale menu above the visualization
  (numeric spinner + slider, 0.1–2.0, default 1.0, `src/components/CanvasSide.tsx`)
  feeds Konva's `scale={{x, y}}`. Set it to **2.0** and recapture; add a 0.5
  capture if the graph clips. This is what Phase 8 step 5's paper scaling must
  reproduce.
- **`s1-pointers-fontsize.png`** — the toolbar zoom buttons (second button group)
  change **editor font size only**: default 14, min 10, ±1 per click
  (`src/components/Editor.tsx:91`, the only `slot('zoom')` listener in the
  codebase). Press zoom-in twice and recapture. This is what Phase 9 step 6
  deletes.

**Plan defect this exposes.** Phase 9 step 6 reads "Zoom: dropped in favour of
paper scaling from Phase 8". Paper scaling replaces the canvas slider, not the
editor font buttons — nothing in the new UI replaces those. Either CodeMirror
gets its own font-size control (a theme compartment reconfigured by the same
buttons), or the step should say the capability is being cut deliberately.

**There is no dark-theme screenshot.** The theme toggle is not rendered:
`ThemeButton` is commented out at `src/components/CanvasSide.tsx:38`, so nothing
emits `changeTheme`. Verified against the deployed bundle — `js/main.js` contains
three `slot('changeTheme')` listeners (Editor, Console, AppWithLang), the
translated labels, and Ace's monokai theme, but no emitter and no button.

Consequence for **Phase 9 step 5**, which lists theme switches among the native
`select` elements replacing `react-select`: there is no shipped behaviour to
reach parity with. That step is a decision — delete the dead listeners, or
implement a feature that never shipped — not a port.

## 4. Benchmark

`programs/bench.c` is the benchmark program. Do not edit it — later phases are
compared against this exact source, with a breakpoint on **line 26**
(`printf("%d\n", total);`, 0-based row 25).

### Measurement A — end-to-end run to breakpoint

1. Reload <http://localhost:8080>, paste `programs/bench.c` (`pbcopy <
baseline/programs/bench.c`), set the one breakpoint on line 26.
2. Paste [scripts/bench-ui.js](scripts/bench-ui.js) into the console.
3. `await plivetBench(5)`.

Reports median ms from click to DebugStatus and to the following paint, plus
ms/step. This is the felt latency, and the headline number in the plan's
"run-to-breakpoint beats the Phase 0 benchmark" criterion.

Read it with one caveat: `StepAll` advances through `setTimeout(loop, 1)`
(`src/server.ts:313`), which browsers clamp to ~4 ms once nested, so most of this
wall clock is the timer rather than work. Phase 6 deletes that timer and will
beat A by a wide margin that says nothing about the Worker. A is the user-facing
number; C below is the one that tracks actual cost.

### Measurement C — single-step latency

Paste [scripts/bench-step.js](scripts/bench-step.js)
into the console with `bench.c` in the editor and no breakpoints, then:

```js
await plivetStepBench(200);
```

It presses Step 200 times and times each round trip — interpreter step, React
commit, full canvas redraw — reporting median, p95 and heap growth. No timer is
involved, so unlike A it measures real work, and it is the number Phase 8's
redraw strategy has to hold: the current code rebuilds the entire scene per step.

### No interpreter-isolated measurement

An earlier draft of this kit isolated the interpreter by exposing the `server`
singleton on `window` and driving `send()` directly, with no timer and no
redraw. That needs a local dev build, which is out of scope now, and a minified
production bundle does not expose the module. So there is no Phase 0 baseline
for interpreter throughput on its own.

The consequence is worth stating plainly: **C is the reference for per-step
cost**, and it bundles interpretation with the full canvas redraw. When Phase 6
moves the interpreter into a Worker and Phase 8 changes the redraw strategy,
their effects land in the same number and cannot be separated from each other
against this baseline. If that separation turns out to matter, add the isolated
measurement then — on the post-Phase-3 toolchain, comparing later phases to each
other rather than to Phase 0.

### Environment hygiene

All measurements: Chrome, one tab, no other heavy applications, machine on
mains power, DevTools open but no profiler recording. Record the exact browser
version in `RESULTS.md` — a later comparison on a different browser build is not
a comparison.

---

## Regression protocol — testing a migration phase against this baseline

Run against a **production** build served statically, the same family the Phase 0
numbers came from:

```bash
npm run build && python3 -m http.server 8082 --bind 127.0.0.1 --directory dist
```

### Tier 1 — five minutes, and it covers the risky parts

Load S1 (`programs/s1-pointers.c`), breakpoint on line 23, run.

1. **Stops at step 17**, GLOBAL frame reads `10, 20, 30, 1, 2, 3, 4`, and pointer
   arrows are drawn. This single check exercises the three changes most likely to
   break silently in the Phase 3 build: the `hashids` import (arrow keys are
   hashids-encoded), the `assert`/`util` polyfills (nothing parses without them),
   and the dynamic interpreter chunk.
2. **Network tab**: `CPP14.bundle.js` is requested on the first run, not at page
   load. That is the deferred parser the plan calls the one piece of the old
   build worth keeping.
3. **Toolbar icons are glyphs, not boxes** — proves the glyphicon fonts survived
   the move from file-loader to asset modules.
4. **Console is clean.**

A pass here means the app is fundamentally intact. A failure names its own cause.

### Tier 2 — screenshot diff

Recapture all eight fixtures at the same viewport (1440 × 900, DPR 2) into a
scratch directory, then:

```bash
bash baseline/scripts/compare-screens.sh /path/to/new-screenshots
```

It reports the fraction of differing pixels per fixture and writes visual diffs
to `<dir>/diff/`. Interpretation: under 0.5% is antialiasing (confirm the red is
scattered, not clustered); over 1% means something moved — open the diff.

Remember S0's GLOBAL frame is uninitialized memory and will always differ; judge
it on structure only.

### Tier 3 — benchmarks

Re-run A and C (`bench-ui.js`, `bench-step.js`) and compare against the recorded
figures: **271 steps / 1442 ms / 5.32 ms per step** for A, **2.9 ms per step**
for C. A change beyond noise in either direction wants an explanation — a
polyfill, a build target, or a redraw path.

### Tier 4 — the checklist rows a build change can actually break

Not all 34. These: 1, 2, 3, 9, 10, 13, 17-20, 22, 24, 24b, 25, 26, 29, 30 —
loading, breakpoints, syntax diagnostics, the file panel, i18n, both zoom
controls, folding, arrows, the modal, and resize.

### Tier 5 — toolchain

```bash
npm test
rm -rf node_modules && npm ci && npm run build   # clean-cache reproduction
```

And confirm source maps still bind: set a breakpoint in `src/components/Editor.tsx`,
run the "PLIVET: attach browser to running server" launch configuration, and check
it is hit in the `.tsx` file rather than in generated output.

## Exit criterion

`results/RESULTS.md` is filled in, screenshots are committed, and every failure
found today is written down as pre-existing. That file becomes the reference for
"the Phase 0 checklist passes" in every later phase.
