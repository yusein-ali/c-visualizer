import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  CELL_HEIGHT,
  CONTROL_EVENT,
  CellModel,
  FoldState,
  Server,
  StepHistory,
  StepModel,
  extractModel,
  foldGroupOf,
  isWithinFold,
  layout,
} from '../src/core';

/**
 * The portable core, exercised without a DOM, a renderer or React - which is
 * the point of it having been extracted at all. Everything below runs on a
 * real interpreter state and plain data.
 */

const execute = (code: string): ExecState[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const states: ExecState[] = [];
  try {
    states.push(interpreter.startStepExecution(code));
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      states.push(interpreter.stepExecute());
      steps += 1;
    }
    return states;
  } finally {
    console.log = log;
  }
};

const cellsOf = (model: StepModel): CellModel[] =>
  model.stacks.flatMap((stack) => stack.rows.flatMap((row) => row));

const textsOf = (model: StepModel): string[] =>
  cellsOf(model).map((cell) => cell.text);

/** The last state in which a model contains a cell the predicate accepts. */
const modelWith = (
  states: ExecState[],
  accept: (model: StepModel) => boolean
): StepModel => {
  const models = states.map((state) => extractModel(state)).filter(accept);
  expect(models.length).toBeGreaterThan(0);
  return models[models.length - 1];
};

const pointerProgram = `
int main(void) {
  int value = 42;
  int *pointer = &value;
  return *pointer;
}
`;

const arrayProgram = `
int main(void) {
  int numbers[3] = {1, 2, 3};
  return numbers[0];
}
`;

describe('extractModel', () => {
  const states = execute(pointerProgram);

  it('spells a variable as type, name, value and address', () => {
    const model = modelWith(states, (m) => textsOf(m).indexOf('value') !== -1);
    const row = model.stacks
      .flatMap((stack) => stack.rows)
      .find((cells) => cells.some((cell) => cell.text === 'value'));
    expect(row).toBeDefined();
    expect(row!.map((cell) => cell.kind)).toEqual([
      'type',
      'name',
      'value',
      'address',
    ]);
    expect(row![0].text).toBe('int');
  });

  it('resolves a pointer to the key of the cell it points at', () => {
    const model = modelWith(states, (m) => 0 < m.pointers.length);
    const pointer = model.pointers[0];
    const keys = cellsOf(model).map((cell) => cell.key);
    expect(keys).toContain(pointer.from);
    expect(keys).toContain(pointer.to);
    const from = cellsOf(model).find((cell) => cell.key === pointer.from);
    expect(from!.pointerTarget).toBe(pointer.to);
  });

  it('reports where the next statement is', () => {
    const model = extractModel(states[1]);
    expect(model.codeRange).not.toBeNull();
    expect(model.codeRange!.begin.y).toBeGreaterThan(0);
  });

  it('answers an absent state with an empty model rather than throwing', () => {
    expect(extractModel(null)).toEqual({
      stacks: [],
      pointers: [],
      codeRange: null,
    });
    expect(extractModel(undefined).stacks).toEqual([]);
  });

  it('produces only what survives structuredClone', () => {
    const model = modelWith(states, (m) => 0 < m.stacks.length);
    const plain = (value: unknown): boolean => {
      if (value === null) {
        return true;
      }
      if (Array.isArray(value)) {
        return value.every(plain);
      }
      switch (typeof value) {
        case 'string':
        case 'number':
        case 'boolean':
        case 'undefined':
          return true;
        case 'object':
          return (
            Object.getPrototypeOf(value) === Object.prototype &&
            Object.values(value as object).every(plain)
          );
        default:
          return false;
      }
    };
    expect(plain(model)).toBe(true);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });

  it('gives an aggregate a fold cell and its members that fold group', () => {
    const model = modelWith(
      execute(arrayProgram),
      (m) => cellsOf(m).filter((cell) => cell.kind === 'fold').length > 0
    );
    const fold = cellsOf(model).find((cell) => cell.kind === 'fold')!;
    expect(fold.foldTarget).toBeDefined();
    const members = cellsOf(model).filter(
      (cell) => cell.foldGroup === fold.foldTarget
    );
    expect(0 < members.length).toBe(true);
  });
});

describe('layout', () => {
  const model = modelWith(
    execute(pointerProgram),
    (m) => 0 < m.pointers.length
  );

  it('squares off every row to the same width', () => {
    const geometry = layout(model, new FoldState());
    for (const stack of geometry.stacks) {
      const widths = stack.rows.map((row) =>
        row.reduce((sum, cell) => sum + cell.width, 0)
      );
      for (const width of widths) {
        expect(width).toBeCloseTo(widths[0]);
      }
      expect(stack.width).toBeCloseTo(widths[0]);
    }
  });

  it('stacks rows one cell height apart below the header', () => {
    const geometry = layout(model, new FoldState());
    const stack = geometry.stacks[0];
    stack.rows.forEach((row, index) => {
      expect(row[0].y).toBe(stack.y + CELL_HEIGHT * (index + 1));
      expect(row[0].x).toBe(stack.x);
    });
  });

  it('routes an arrow between the cells a pointer connects', () => {
    const geometry = layout(model, new FoldState());
    expect(geometry.arrows.length).toBe(model.pointers.length);
    const arrow = geometry.arrows[0];
    const coloured = geometry.stacks
      .flatMap((stack) => stack.rows.flatMap((row) => row))
      .filter((cell) => 0 < cell.colors.length);
    expect(coloured.map((cell) => cell.colors[0])).toContain(arrow.color);
    expect(arrow.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('gives the same pointer the same colour on every step', () => {
    const first = layout(model, new FoldState()).arrows[0];
    const again = layout(model, new FoldState()).arrows[0];
    expect(again.color).toBe(first.color);
  });

  it('drops folded rows and turns the triangle over', () => {
    const arrays = modelWith(
      execute(arrayProgram),
      (m) => cellsOf(m).filter((cell) => cell.kind === 'fold').length > 0
    );
    const folds = new FoldState();
    const open = layout(arrays, folds);
    const group = cellsOf(arrays).find(
      (cell) => cell.kind === 'fold'
    )!.foldTarget!;
    folds.toggle(group);
    const closed = layout(arrays, folds);

    const rowCount = (geometry: { stacks: { rows: unknown[] }[] }) =>
      geometry.stacks.reduce((sum, stack) => sum + stack.rows.length, 0);
    expect(rowCount(closed)).toBeLessThan(rowCount(open));

    const triangle = (geometry: typeof open) =>
      geometry.stacks
        .flatMap((stack) => stack.rows.flatMap((row) => row))
        .find((cell) => cell.foldTarget === group)!.text;
    expect(triangle(open)).toBe('▼');
    expect(triangle(closed)).toBe('▲');
  });

  it('leaves the model untouched, so a step can be laid out twice', () => {
    const before = JSON.stringify(model);
    const folds = new FoldState();
    layout(model, folds);
    layout(model, folds);
    expect(JSON.stringify(model)).toBe(before);
  });
});

describe('fold state', () => {
  it('hides a group and everything nested inside it', () => {
    const outer = foldGroupOf(undefined, 'array');
    const inner = foldGroupOf(outer, 'member');
    expect(isWithinFold(inner, outer)).toBe(true);
    expect(isWithinFold(outer, inner)).toBe(false);

    const folds = new FoldState();
    folds.toggle(outer);
    expect(folds.hides(inner)).toBe(true);
    expect(folds.hides(undefined)).toBe(false);
    folds.toggle(outer);
    expect(folds.hides(inner)).toBe(false);
  });

  it('does not confuse a group with one whose name starts the same', () => {
    const folded = foldGroupOf(undefined, 'count');
    const other = foldGroupOf(undefined, 'counter');
    const folds = new FoldState();
    folds.toggle(folded);
    expect(folds.hides(other)).toBe(false);
  });
});

describe('step history', () => {
  const state = (): ExecState => ({}) as ExecState;

  it('answers every step of a run that fits', () => {
    const history = new StepHistory(10);
    for (let step = 0; step < 5; step += 1) {
      history.push(state(), `output ${step}`);
    }
    expect(history.length).toBe(5);
    expect(history.outputAt(3)).toBe('output 3');
    expect(history.oldestRetained()).toBe(1);
  });

  it('drops the middle of a long run but never its beginning', () => {
    const limit = 10;
    const history = new StepHistory(limit);
    for (let step = 0; step < 100; step += 1) {
      history.push(state(), `output ${step}`);
    }
    expect(history.length).toBe(100);
    // The first state is what BackAll returns to, however long the run.
    expect(history.has(0)).toBe(true);
    expect(history.has(50)).toBe(false);
    expect(history.has(99)).toBe(true);
    expect(history.oldestRetained()).toBe(100 - limit);
    // Stepping forward out of the dropped stretch resumes at the window.
    expect(history.nextRetained(1)).toBe(100 - limit);
    expect(history.lastState()).toBeDefined();
  });

  it('starts empty again for a new session', () => {
    const history = new StepHistory(10);
    history.push(state(), 'output');
    history.clear();
    expect(history.length).toBe(0);
    expect(history.has(0)).toBe(false);
  });
});

describe('a debug session', () => {
  const code = `
int add(int a, int b) { int sum = a + b; return sum; }
int main(void) {
  int total = 0;
  for (int i = 0; i < 30; i = i + 1) {
    total = add(total, i);
  }
  return total;
}
`;
  const quiet = <T>(run: () => T): T => {
    const log = console.log;
    console.log = () => undefined;
    try {
      return run();
    } finally {
      console.log = log;
    }
  };
  const send = (server: Server, controlEvent: CONTROL_EVENT) =>
    quiet(() => server.send({ controlEvent, sourcecode: code }));

  it('steps back through every step to the first one', async () => {
    const server = new Server();
    await send(server, 'Start');
    for (let step = 0; step < 6; step += 1) {
      await send(server, 'Step');
    }
    const walked: number[] = [];
    for (let step = 0; step < 8; step += 1) {
      const back = await send(server, 'StepBack');
      expect(back.execState).toBeDefined();
      walked.push(back.step);
    }
    // Down to the beginning, and then it stays there.
    expect(walked).toEqual([5, 4, 3, 2, 1, 0, 0, 0]);
  });

  it('returns to the first state after a run longer than the history', async () => {
    const server = new Server(5);
    await send(server, 'Start');
    for (let step = 0; step < 40; step += 1) {
      await send(server, 'Step');
    }
    const home = await send(server, 'BackAll');
    expect(home.step).toBe(0);
    expect(home.execState).toBeDefined();
  });

  it('never answers with a state it has dropped', async () => {
    const server = new Server(5);
    await send(server, 'Start');
    for (let step = 0; step < 30; step += 1) {
      await send(server, 'Step');
    }
    await send(server, 'BackAll');
    // Forward across the gap the eviction left, and on to the head.
    for (let step = 0; step < 40; step += 1) {
      const forward = await send(server, 'Step');
      expect(forward.execState).toBeDefined();
    }
    // Backward from wherever that ended up.
    for (let step = 0; step < 10; step += 1) {
      const back = await send(server, 'StepBack');
      expect(back.execState).toBeDefined();
    }
  });

  it('forgets the previous session when a new one starts', async () => {
    const server = new Server(5);
    await send(server, 'Start');
    for (let step = 0; step < 20; step += 1) {
      await send(server, 'Step');
    }
    const restarted = await send(server, 'Start');
    expect(restarted.step).toBe(0);
    expect((await send(server, 'StepBack')).step).toBe(0);
  });
});
