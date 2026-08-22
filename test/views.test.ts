import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { extractModel } from '../src/core/extractModel';
import { StepModel } from '../src/core';
import { callStackRows } from '../src/ui/graph';
import { MutationView } from '../src/ui/views';

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
const stepOn = (line: number): StepModel =>
  steps.find(
    (step) => step.codeRange !== null && step.codeRange.begin.y === line
  )!;

describe('the call stack beside the statement', () => {
  it('names the active functions innermost first', () => {
    const inside = stepOn(2);
    expect(inside.frames.map((frame) => frame.name)).toEqual(['main', 'twice']);
    expect(callStackRows(inside.frames).map((row) => row.name)).toEqual([
      'twice()',
      'main()',
    ]);
  });

  it('pairs argument values with their corresponding parameters', () => {
    const [current] = callStackRows(stepOn(2).frames);
    expect(current.arguments).toBe('n = 1');
    expect(current.where).toBe('call on line 7');
    expect(current.current).toBe(true);
  });
});

describe('object writes over time under the canvas', () => {
  const mounted = () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = new MutationView(host);
    return { host, view };
  };

  it('records writes in the frame where they happened', () => {
    const after = steps[steps.length - 1];
    const inside = after.mutations.find((one) => one.frame === 'twice')!;
    expect(inside).toMatchObject({
      target: 'n',
      before: '1',
      after: '2',
      line: 2,
    });
  });

  it("records the caller's own write against the caller", () => {
    const after = steps[steps.length - 1];
    const outside = after.mutations.filter(
      (one) => one.frame === 'main' && one.target === 'total'
    );
    expect(outside.length).toBeGreaterThan(0);
    expect(outside[outside.length - 1].after).toBe('2');
  });

  it('records every increment made by a preprocessed for statement', () => {
    // S5 hands the visualizer ordinary preprocessed C; this is the loop shape
    // used by those exercises after preprocessing.
    const loop = stepsOf(`int main(void) {
  for (int i = 0; i < 4; i++) {
  }
  return 0;
}`);
    const updates = loop[loop.length - 1].mutations.filter(
      (mutation) => mutation.target === 'i'
    );

    expect(updates.map(({ before, after }) => ({ before, after }))).toEqual([
      { before: '0', after: '1' },
      { before: '1', after: '2' },
      { before: '2', after: '3' },
      { before: '3', after: '4' },
    ]);
    expect(updates.every((mutation) => mutation.frame === 'main')).toBe(true);
  });

  it('records the stored value of prefix and postfix updates', () => {
    const updated = stepsOf(`int main(void) {
  int i = 1;
  i++;
  ++i;
  i--;
  --i;
  return i;
}`);

    expect(
      updated[updated.length - 1].mutations
        .filter((mutation) => mutation.target === 'i')
        .map(({ before, after }) => ({ before, after }))
    ).toEqual([
      { before: '1', after: '2' },
      { before: '2', after: '3' },
      { before: '3', after: '2' },
      { before: '2', after: '1' },
    ]);
  });

  it('never shows writes from a future step', () => {
    expect(stepOn(6).mutations.length).toBeLessThan(
      steps[steps.length - 1].mutations.length
    );
  });

  it('shows the newest write first', () => {
    const { host, view } = mounted();
    const after = steps[steps.length - 1];
    view.setMutations(after.mutations);
    const rows = Array.from(view.root.querySelectorAll('tr')).slice(1);
    expect(rows[0].textContent).toContain(after.mutations.slice(-1)[0].target);
    view.destroy();
    host.remove();
  });

  it('is a collapsible region and builds no rows while closed', () => {
    const { host, view } = mounted();
    view.setMutations(steps[steps.length - 1].mutations);
    expect(view.root.open).toBe(true);
    expect(view.root.querySelector('summary')?.className).toBe(
      'plivet-view__title'
    );
    expect(view.root.querySelectorAll('table')).toHaveLength(1);

    view.root.open = false;
    view.root.dispatchEvent(new Event('toggle'));
    expect(view.root.querySelectorAll('table')).toHaveLength(0);

    view.root.open = true;
    view.root.dispatchEvent(new Event('toggle'));
    expect(view.root.querySelectorAll('table')).toHaveLength(1);
    view.destroy();
    host.remove();
  });
});
