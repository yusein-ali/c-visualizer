/*
 * PLIVET Phase 0 — run-to-breakpoint benchmark (UI path).
 *
 * Measures StepAll from a freshly started session to the breakpoint: restart,
 * then run, timing until DebugStatus reports the stop and the canvas repaints.
 * Parse and interpreter-chunk load happen on the restart click and are outside
 * the measured window, so all runs are comparable (bench-step.js reports that
 * cost separately as ms_start).
 *
 * Buttons are located by their title attribute, not by index: CtrlButtons
 * rewrites button 4 between "Start" and "Step" and button 5 between "Exec" and
 * "StepAll" depending on its own state, and several buttons are disabled in
 * states where you would expect them live.
 *
 * Preconditions:
 *   1. baseline/programs/bench.c is pasted into the editor, unmodified.
 *   2. A breakpoint on editor line 26 (the printf), and it is the only one.
 *
 * Usage: paste this whole file into the DevTools console, then: await plivetBench(5)
 */
window.plivetBench = async function plivetBench(runs = 5) {
  const groups = document.querySelectorAll('.btn-toolbar .btn-group');
  if (groups.length < 1) throw new Error('control buttons not found');
  const buttons = Array.from(groups[0].querySelectorAll('button'));
  if (buttons.length !== 6)
    throw new Error(`expected 6 debug buttons, got ${buttons.length}`);

  const TITLES = {
    Start: ['restart step execution', '現在のプログラムで再ステップ実行'],
    StepAll: ['execute all step', 'プログラムを最後まで実行する'],
  };
  const titleOf = (b) => (b.getAttribute('title') || '').trim();
  const find = (names) =>
    buttons.find((b) => names.includes(titleOf(b)) && !b.disabled) ||
    buttons.find((b) => names.includes(titleOf(b)));

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let statusHost = null;
  while (walker.nextNode()) {
    if (walker.currentNode.textContent.trim().startsWith('DebugStatus:')) {
      statusHost = walker.currentNode.parentElement;
      break;
    }
  }
  if (!statusHost) throw new Error('DebugStatus element not found');
  const status = () => statusHost.textContent.replace(/\s+/g, ' ').trim();
  const settled = (t) =>
    /DebugStatus: (Step \d+|First|EOF|stdin|Stop)$/.test(t);

  function waitForSettled(timeoutMs = 120000) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const text = status();
        if (!settled(text)) return;
        const tStatus = performance.now();
        observer.disconnect();
        clearTimeout(timer);
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve({ text, tStatus, tPaint: performance.now() })
          )
        );
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(
          new Error(
            `timed out after ${timeoutMs} ms, status still "${status()}"`
          )
        );
      }, timeoutMs);
      observer.observe(statusHost, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    });
  }

  const heapMb = () =>
    performance.memory
      ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1)
      : null;
  const rows = [];

  for (let run = 1; run <= runs; run++) {
    if (status() !== 'DebugStatus: First') {
      const start = find(TITLES.Start);
      if (!start || start.disabled)
        throw new Error(`no enabled restart button at "${status()}"`);
      start.click();
      const s = await waitForSettled(30000);
      if (s.text !== 'DebugStatus: First')
        throw new Error(`restart landed on "${s.text}"`);
    }

    const go = find(TITLES.StepAll);
    if (!go || go.disabled)
      throw new Error(`no enabled run button at "${status()}"`);

    const heapBefore = heapMb();
    const t0 = performance.now();
    go.click();
    const { text, tStatus, tPaint } = await waitForSettled();
    const step = Number((text.match(/Step (\d+)/) || [, NaN])[1]);
    rows.push({
      run,
      status: text.replace('DebugStatus: ', ''),
      step,
      ms_to_status: +(tStatus - t0).toFixed(1),
      ms_to_paint: +(tPaint - t0).toFixed(1),
      ms_per_step: Number.isFinite(step)
        ? +((tStatus - t0) / step).toFixed(2)
        : null,
      heap_before_mb: heapBefore,
      heap_after_mb: heapMb(),
    });
    console.log(`run ${run}:`, rows[rows.length - 1]);
  }

  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  console.table(rows);
  const summary = {
    runs: rows.length,
    stopped_at: rows[0].status,
    steps: rows[0].step,
    median_ms_to_status: median(rows.map((r) => r.ms_to_status)),
    median_ms_to_paint: median(rows.map((r) => r.ms_to_paint)),
    median_ms_per_step: median(rows.map((r) => r.ms_per_step)),
    heap_first_run_mb: rows[0].heap_before_mb,
    heap_last_run_mb: rows[rows.length - 1].heap_after_mb,
    userAgent: navigator.userAgent,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
};
console.log('loaded — run:  await plivetBench(5)');
