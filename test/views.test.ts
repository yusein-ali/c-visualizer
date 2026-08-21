import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel, emptyStepModel } from '../src/core';
import { ViewStack } from '../src/ui/views';

/**
 * The two panes under the canvas, and the panel that switches them.
 *
 * They answer questions the memory map does not. The map draws the memory of
 * one step; these draw the shape of the run - which calls it is inside, and
 * which writes it has made. The frame column of the second is the point of
 * having it: C passes by value, and a write inside a callee is a write to the
 * callee's own copy.
 */

const PROGRAM = `int twice(int n) {
  n = n * 2;
  return n;
}
int main(void) {
  int total = 1;
  total = twice(total);
  return total;
}`;

const stepsOf = (code: string): StepModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const steps: StepModel[] = [];
  try {
    let state = interpreter.startStepExecution(code);
    let count = 0;
    while (interpreter.isStepExecutionRunning() && count < 300) {
      steps.push(extractModel(state));
      state = interpreter.stepExecute();
      count += 1;
    }
    steps.push(extractModel(state));
  } finally {
    console.log = log;
  }
  return steps;
};

const steps = stepsOf(PROGRAM);

/** The first step whose marker is on that line. */
const stepOn = (line: number): StepModel =>
  steps.find(
    (step) => step.codeRange !== null && step.codeRange.begin.y === line
  )!;

const mounted = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const views = new ViewStack(host);
  return { host, views };
};

const textOf = (views: ViewStack, selector: string) =>
  Array.from(views.root.querySelectorAll(selector)).map(
    (element) => element.textContent ?? ''
  );

describe('the call stack', () => {
  it('names the functions the run is inside, innermost first', () => {
    const inside = stepOn(2);
    expect(inside.frames.map((frame) => frame.name)).toEqual(['main', 'twice']);

    const { host, views } = mounted();
    views.showPane('callStack', true);
    views.render(inside);
    expect(textOf(views, '.plivet-view__name')).toEqual(['twice()', 'main()']);
    views.destroy();
    host.remove();
  });

  it('says what a call was passed, beside the parameter it filled', () => {
    const inside = stepOn(2);
    const twice = inside.frames.find((frame) => frame.name === 'twice')!;
    expect(twice.arguments).toEqual([{ name: 'n', value: '1' }]);
    expect(twice.calledFrom).toBe(7);
  });

  it('says nothing is running when nothing is', () => {
    const { host, views } = mounted();
    views.showPane('callStack', true);
    views.render(emptyStepModel());
    expect(views.root.textContent).toContain('nothing is running');
    views.destroy();
    host.remove();
  });
});

describe('variables over time', () => {
  it('records the write inside the callee against the callee’s frame', () => {
    // `n = n * 2` writes the copy the call was given, not the caller's total.
    const after = steps[steps.length - 1];
    const inside = after.mutations.find((one) => one.frame === 'twice')!;
    expect(inside.target).toBe('n');
    expect(inside.before).toBe('1');
    expect(inside.after).toBe('2');
    expect(inside.line).toBe(2);
  });

  it('records the caller’s own write against the caller', () => {
    const after = steps[steps.length - 1];
    const outside = after.mutations.filter(
      (one) => one.frame === 'main' && one.target === 'total'
    );
    expect(outside.length).toBeGreaterThan(0);
    expect(outside[outside.length - 1].after).toBe('2');
  });

  it('grows as the run goes, and never looks ahead of the step', () => {
    const early = stepOn(6);
    const late = steps[steps.length - 1];
    expect(early.mutations.length).toBeLessThan(late.mutations.length);
  });

  it('shows the newest write first', () => {
    const { host, views } = mounted();
    views.showPane('mutations', true);
    views.render(steps[steps.length - 1]);
    const rows = Array.from(
      views.root.querySelectorAll(
        '.plivet-view--mutations tbody tr, .plivet-view--mutations tr'
      )
    ).slice(1);
    const last = steps[steps.length - 1].mutations.slice(-1)[0];
    expect(rows[0].textContent).toContain(last.target);
    views.destroy();
    host.remove();
  });
});

describe('the panel that switches them', () => {
  it('opens neither pane until it is asked to', () => {
    const { host, views } = mounted();
    views.render(steps[steps.length - 1]);
    expect(views.isPaneShown('callStack')).toBe(false);
    expect(views.isPaneShown('mutations')).toBe(false);
    const panes = views.root.querySelectorAll('.plivet-view');
    expect(
      Array.from(panes).every((pane) => (pane as HTMLElement).hidden)
    ).toBe(true);
    views.destroy();
    host.remove();
  });

  it('fills a pane as soon as it is switched on', () => {
    const { host, views } = mounted();
    views.render(stepOn(2));
    const box = views.root.querySelectorAll<HTMLInputElement>(
      '.plivet-views__switch input'
    )[0];
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(views.isPaneShown('callStack')).toBe(true);
    expect(views.root.textContent).toContain('twice()');
    views.destroy();
    host.remove();
  });

  it('costs a closed pane no rows at all', () => {
    // A run of a hundred thousand writes should cost a reader who is not
    // looking at them nothing.
    const { host, views } = mounted();
    views.render(steps[steps.length - 1]);
    expect(views.root.querySelectorAll('.plivet-view__table')).toHaveLength(0);
    views.destroy();
    host.remove();
  });
});
