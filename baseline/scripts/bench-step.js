/*
 * PLIVET Phase 0 — single-step latency benchmark (UI path, no timer).
 *
 * Works on any build, including the deployed gh-pages bundle — it needs no
 * source patch. It drives the Step button N times and measures each round trip:
 * interpreter step + React commit + full canvas redraw. That is the latency a
 * user feels while single-stepping, and unlike the run-to-breakpoint number it
 * is not dominated by the setTimeout(loop, 1) throttle in StepAll
 * (src/server.ts:313).
 *
 * Preconditions:
 *   1. baseline/programs/bench.c is pasted into the editor, unmodified.
 *   2. No breakpoint. Single-stepping ignores them anyway — only StepAll/Exec
 *      consult lineNumOfBreakpoint — but leave them off so the setup is
 *      unambiguous for whoever repeats this in a later phase.
 *   3. DebugStatus reads "Stop" or is empty — reload the page if unsure.
 *
 * Usage: paste into the DevTools console, then:  await plivetStepBench(200)
 */
window.plivetStepBench = async function plivetStepBench(steps = 200) {
  const groups = document.querySelectorAll('.btn-toolbar .btn-group');
  if (groups.length < 1) throw new Error('control buttons not found');
  const buttons = groups[0].querySelectorAll('button');
  if (buttons.length !== 6)
    throw new Error(`expected 6 debug buttons, got ${buttons.length}`);
  const STOP = buttons[1];
  // Button 4 does double duty: its command is "Start" while the app is stopped
  // (CtrlButtons keeps `Stop: false` then, which also leaves button 0 disabled)
  // and becomes "Step" once a session exists. One button drives the whole run.
  const STEP = buttons[4];

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

  function waitForChange(from, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        const text = status();
        if (text === from) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve({ text, at: performance.now() });
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

  const current = status();
  if (current !== 'DebugStatus:' && current !== 'DebugStatus: Stop') {
    if (STOP.disabled)
      throw new Error(`cannot reset: stop button disabled at "${current}"`);
    STOP.click();
    await waitForChange(current, 10000).catch(() => {});
  }

  if (STEP.disabled) {
    throw new Error(
      'step/start button is disabled — reload the page and try again'
    );
  }

  const heapBefore = heapMb();
  const tStart = performance.now();
  const before = status();
  STEP.click(); // first click starts the session
  const started = await waitForChange(before);
  const msStart = +(started.at - tStart).toFixed(1);

  const samples = [];
  let last = started.text;
  let finalState = last;
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now();
    STEP.click();
    let result;
    try {
      result = await waitForChange(last);
    } catch (e) {
      console.warn(`stopped at step ${i}: ${e.message}`);
      break;
    }
    samples.push(result.at - t0);
    last = result.text;
    finalState = last;
    if (/EOF|stdin|Stop/.test(last)) {
      console.warn(
        `reached ${last} after ${samples.length} steps — use a longer program or fewer steps`
      );
      break;
    }
  }

  const heapAfter = heapMb();
  if (!STOP.disabled) STOP.click();

  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (q) =>
    +sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].toFixed(
      2
    );
  const summary = {
    steps_measured: samples.length,
    final_status: finalState.replace('DebugStatus: ', ''),
    ms_start: msStart,
    ms_per_step_median: pick(0.5),
    ms_per_step_p95: pick(0.95),
    ms_per_step_min: +sorted[0].toFixed(2),
    ms_per_step_max: +sorted[sorted.length - 1].toFixed(2),
    ms_total: +samples.reduce((a, b) => a + b, 0).toFixed(1),
    heap_before_mb: heapBefore,
    heap_after_mb: heapAfter,
    heap_growth_mb:
      heapBefore !== null ? +(heapAfter - heapBefore).toFixed(1) : null,
    userAgent: navigator.userAgent,
  };
  console.table(summary);
  console.log(JSON.stringify(summary, null, 2));
  return summary;
};
console.log('loaded — run:  await plivetStepBench(200)');
