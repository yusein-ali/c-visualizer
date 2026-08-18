# Phase 0 baseline — results

Fill in every `_____`. Anything that fails today is **pre-existing**, not a
migration regression; say so explicitly rather than leaving a blank.


## Environment

| Field | Value |
|---|---|
| Date | _____ |
| Build under test | `gh-pages` checkout served on :8080 (prod, built from `7045f42`) |
| Viewport (DevTools responsive) | 1440 × 900 @ DPR ___ , page zoom ___ % |
| Commit | _____ |
| `src` identical to `master`? | yes / no — `git diff --stat 7045f42..master -- src test webpack.config.js webpack.config.dev.js babel.config.js tsconfig.prod.json` |
| Chrome profile (clean / extensions disabled?) | _____ |
| OS | _____ |
| Browser + version | _____ |
| Machine (CPU, RAM, on mains?) | _____ |

## Bundle baseline

Already captured — see [deployed-bundle.txt](deployed-bundle.txt). No local
Node 16 build is part of Phase 0; the toolchain is replaced in Phases 2–4.

Carry forward for Phase 1's exit criterion: `Java8.bundle.js` 473,674 B and
`Python3.bundle.js` 183,677 B must disappear, and `CPP14-Java8-Python3.bundle.js`
(417,882 B) should fold back into `CPP14`. Total today: 4,320,799 B.

## Parity checklist

`ok` pass, `nok` fail, `ok*` works with console errors or visible defects.
Rows phrased as "confirm X is absent" pass when X is indeed absent.

| # | Check | Result | Notes |
|---|---|---|---|
| 1 | Page loads at :8080, editor shows the C sample, no console errors | ok | _____ |
| 2 | Canvas area renders empty without error before any run | ok | _____ |
| 3 | Run the sample to EOF (last button, twice if needed) | ok | _____ |
| 4 | Output pane shows the expected stdout | ok | _____ |
| 5 | Step forward: stacks, variables and code highlight advance together | ok | _____ |
| 6 | Step backward returns to the previous state exactly | ok | _____ |
| 7 | BackAll returns to step 0 | ok | _____ |
| 8 | Stop clears the session; buttons return to their initial enablement | ok | _____ |
| 8b | After a run-to-breakpoint: is Stop disabled, and does the step-forward arrow restart instead of stepping? (**expected defect**) | ok | defect approved |
| 9 | Set a breakpoint (click ≤25 px from the gutter's left edge) — marker appears | ok | _____ |
| 10 | Run stops at the breakpoint; DebugStatus shows `Step N` | ok | works, but easy to miss — it sits above the editor, under the toolbar |
| 11 | Clicking the marker again clears the breakpoint | ok | _____ |
| 12 | Multiple breakpoints; the first reached wins | ok* | first one wins; the second is unverifiable — there is no continue (see 8b) |
| 13 | Syntax error (delete a `;`) is marked in the gutter within ~1 s | ok | the error is shown as tooltip |
| 14 | Fixing the error clears the marker | ok | _____ |
| 15 | stdin: `s4-stdin.c`, enter `3` then `4`, output is `7` | ok | _____ |
| 15b | each stdin submission advances one step only; run must be pressed again | ok | but stdin management in console is not very intuitive |
| 16 | Edit source mid-debug then Step → modal appears; "don't ask again" suppresses it | ok | the stepping must be started at init|
| 17 | Upload a file; it appears in the file list | ok | _____ |
| 18 | Download the uploaded file from the list | ok | _____ |
| 19 | Delete the uploaded file; list updates | ok | _____ |
| 20 | Sample's `fopen("PLIVET.txt","w")` section produces a readable file | ok | _____ |
| 21 | Theme toggle — **known absent**: `ThemeButton` commented out at `CanvasSide.tsx:38`, no `changeTheme` emitter in the bundle. Confirm no toggle is visible. | ok | absence confirmed — this row passes by being absent |
| 22 | UI language ja/en switches all labels and tooltips | ok | _____ |
| 23 | Language switch swaps the sample only when the source is untouched | ok | _____ |
| 24 | Toolbar zoom in / out / reset changes the **editor font size** (not the canvas) | ok | _____ |
| 24b | Canvas scale spinner and slider (0.1–2.0) rescale the **visualization** | ok | _____ |
| 25 | Canvas fold toggle collapses and expands a struct/array group | ok | _____ |
| 26 | Pointer arrows are drawn and follow their targets across steps | ok | _____ |
| 27 | Prog-lang switch → Java (removed in Phase 1 — record today's behaviour) | nok | session starts, then stops immediately with no error, alert or message |
| 28 | Prog-lang switch → Python (removed in Phase 1 — record today's behaviour) | nok | same as 27 — starts, then stops silently |
| 29 | "How to use" opens and closes | ok | _____ |
| 30 | Window resize relayouts editor and canvas | ok | _____ |

Deviations accepted as pre-existing failures (these do **not** need to pass in
later phases; anything else must):

- **After a run-to-breakpoint you cannot stop or step forward.** `Editor.recieve`
  returns early on `Executing`, so `CtrlButtons` never sees the state that
  enables Start/Stop; its `Debugging` branch leaves both `false`. At a
  breakpoint: Stop is disabled, and button 4's command is `Start`, not `Step`
  (`this.state.Stop ? 'Step' : 'Start'`) — so pressing the step-forward arrow
  **restarts the program from the beginning**. Step-back and back-all work. This
  is the `DEBUG_STATE`-to-enablement mapping Phase 9 step 2 says to preserve
  as-is; preserving it preserves this. Decide deliberately.
- **Uninitialized heap values change on every run.** Cells allocated but never
  written show non-reproducible garbage, and because cell width follows text
  length the table geometry moves with it. S1 was amended so every allocated
  cell is written; S0 is the shipped sample and stays volatile — compare it on
  structure only (frame count, row count, arrow topology, fold markers), never
  on values or widths. Phase 11's `extractModel` fixtures must not assert on
  uninitialized memory either.
- **Two independent zoom controls exist.** The toolbar buttons resize the editor
  font; the canvas spinner/slider scales the visualization. Phase 9 step 6
  assumes paper scaling replaces the toolbar buttons — it does not. Decide
  whether CodeMirror keeps a font-size control or the capability is cut.
- **Theme switching does not exist.** Three `slot('changeTheme')` listeners, the
  `Theme` type, the translated labels and Ace's monokai theme all ship, but
  `ThemeButton` is commented out at `CanvasSide.tsx:38` and nothing emits the
  event. Phase 9 step 5 must treat the theme switch as a new feature or delete
  the dead code — there is no parity target.
- **The debug status is in an unusual place.** It renders above the editor,
  under the toolbar, as a bare `DebugStatus: Step N` line — easy to miss, and it
  was initially read as missing. Phase 9 step 2 rebuilds the controls, the step
  counter and the status together. The plan says parity, no visual redesign, so
  moving it next to the controls would be a deliberate deviation. Worth taking:
  it costs nothing while that markup is being written anyway.
- **Java and Python do not work and fail silently.** Selecting either language
  starts a session that stops immediately with no error, alert or message. No
  exception reaches `Editor.send`'s `catch`, which would have raised an
  `alert` — so the interpreter is most likely loading and then reporting
  `isStepExecutionRunning() === false` on the first step, which `server.Step`
  turns into `debugState: 'EOF'`. (Mechanism inferred from the code, not
  instrumented; the observable is "starts, then stops".) This is the state
  Phase 1 deletes, and it confirms the plan's premise that removal is deletion
  rather than abandoning working features.
- **There is no "continue" from a breakpoint.** Same root cause as 8b, but this
  is the form users hit: the run button's command at a breakpoint is `Exec`,
  which restarts from step 0 and stops at the same breakpoint again. Reaching a
  second breakpoint requires clearing the first. Phase 7's breakpoint work and
  Phase 9 step 2's enablement mapping both have to answer this.
- **Syntax errors surface only as a gutter tooltip** (row 13) — nothing inline in
  the text. Phase 7 step 4 maps these onto `@codemirror/lint`, which underlines
  the range and shows a panel. That is a visible improvement, not a parity
  match; accept it explicitly.
- **The stdin console is unintuitive** (row 15b) — input and output share one Ace
  buffer, and submission is "type at the end, press Enter, then press run
  again". Phase 9 step 3 splits it into a `pre` plus a `textarea`, which changes
  the interaction. Not a regression, but not parity either.

## Screenshots

| Fixture | Breakpoint | Stops at step | File | Notes |
|---|---|---|---|---|
| S0 default sample | 28 | **27** | `screenshots/s0-light.png` | GLOBAL frame values volatile — compare structure only |
| S1 pointers | 23 | **17** | `screenshots/s1-pointers-light.png` | recaptured after the heap fix; GLOBAL reads 10,20,30,1,2,3,4 |
| S1 pointers, canvas scale 2.0 | 23 | **17** | `screenshots/s1-pointers-scale.png` | graph clips at the canvas edge; no panning exists today |
| S1 pointers, editor font +2 | 23 | **17** | `screenshots/s1-pointers-fontsize.png` | editor font 14 → 16; canvas unaffected |
| S2 arrays | 16 | **25** | `screenshots/s2-arrays-light.png` | two fold levels on `grid`; char cells show code + glyph |
| S3 recursion | 8 | **13** | `screenshots/s3-recursion-light.png` | first hit: `main` + `fact` + `fact.2` + `fact.3` + `fact.4` |
| S4 stdin, parked at first `scanf` | none | n/a (`stdin`) | `screenshots/s4-stdin-waiting.png` | BackAll/StepBack disabled, Start/Stop enabled |
| S4 stdin, at EOF (output `7`) | none | n/a (`EOF`) | `screenshots/s4-stdin-light.png` | console shows `3`, `4`, `7` — input echoed with output |

## Benchmark — `programs/bench.c`, breakpoint on line 26

### A. End-to-end through the UI (`bench-ui.js`, 5 runs)

| Metric | Value |
|---|---|
| Steps to breakpoint | **271** |
| Median ms to DebugStatus | **1442.1** |
| Median ms to paint | **1451.6** (paint adds ~9.5 ms) |
| Median ms per step | **5.32** |
| JS heap across the 5 runs (MB) | 21.7 → 28.2 |

Paste the JSON summary:

```json
{
  "runs": 5,
  "stopped_at": "Step 271",
  "steps": 271,
  "median_ms_to_status": 1442.1,
  "median_ms_to_paint": 1451.6,
  "median_ms_per_step": 5.32,
  "heap_first_run_mb": 21.7,
  "heap_last_run_mb": 28.2,
  "userAgent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36"
}
```

### C. Single-step latency (`bench-step.js`, 200 steps) — same build as A

| Metric | Value |
|---|---|
| Steps measured | **200** (total 622.3 ms) |
| ms for `Start` (parse + chunk load) | **66.7** |
| Median ms per step | **2.9** |
| p95 ms per step | **4.4** |
| min / max ms per step | **2.3 / 8.2** |
| JS heap growth over 200 steps (MB) | **19.1** (15.3 → 34.4) |

```json
{
  "steps_measured": 200,
  "final_status": "Step 200",
  "ms_start": 66.7,
  "ms_per_step_median": 2.9,
  "ms_per_step_p95": 4.4,
  "ms_per_step_min": 2.3,
  "ms_per_step_max": 8.2,
  "ms_total": 622.3,
  "heap_before_mb": 15.3,
  "heap_after_mb": 34.4,
  "heap_growth_mb": 19.1,
  "userAgent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36"
}
```

### What these numbers say

**The timer dominates the run, as predicted.** A costs 5.32 ms/step against a
nested-`setTimeout` clamp of ~4 ms. Subtracting the clamp puts interpretation
alone near **1.3 ms/step**. C's 2.9 ms/step covers interpretation plus the React
commit plus a full canvas rebuild, so the **redraw is roughly 1.6 ms/step**.

**Run-to-breakpoint is slower per step than single-stepping with a full redraw**
— 5.32 ms against 2.9 ms. The throttle costs more than drawing the entire scene.

**`stateHistory` grows ~95 KB per step.** 19.1 MB over 200 steps, unbounded. A
10,000-step program would take roughly 950 MB and kill the tab. That is the
number Phase 5 step 6's cap exists for, and it is worth re-measuring after the
cap lands.

### Targets these set

Measure every later phase on a **production** build (`yarn build` / `npm run build`,
served statically) — the same family as A and C here.

- **Phase 6** (`StepAll` without the timer, interpreter in a Worker): deleting
  the timer alone should take the 271-step run from **1442 ms to roughly 350 ms**
  (271 × ~1.3 ms). That is the bar — the Worker must not eat the gain. Median
  ms/step must not regress against C's 2.9 ms.
- **Phase 8** (JointJS redraw): run-to-breakpoint must not regress against the
  Phase 6 number, and median ms/step must not regress against C — the current
  code rebuilds the whole scene per step, so C is the figure the redraw strategy
  is answering.
- **Phase 5** (`stateHistory` cap): heap growth over 200 steps must be bounded,
  against the C heap figure.
