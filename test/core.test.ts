import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  CELL_HEIGHT,
  CONTROL_EVENT,
  CellModel,
  ExpressionNodeModel,
  FoldState,
  Server,
  StepHistory,
  StepModel,
  ViewOptions,
  extractModel,
  foldGroupOf,
  isWithinFold,
  MEMORY_ALIGNMENT,
  layout,
  narrowToType,
  startsCollapsed,
  startsShown,
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

/**
 * Whether a value would survive `structuredClone`: the check the Worker
 * boundary actually applies. A class instance loses its prototype and a
 * function is refused outright, so neither may appear in a message.
 */
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
      memory: [],
      functions: [],
      expression: null,
      variables: [],
      inlineValues: [],
      constructStates: [],
      evaluations: [],
      codeRange: null,
    });
    expect(extractModel(undefined).stacks).toEqual([]);
  });

  it('produces only what survives structuredClone', () => {
    const model = modelWith(states, (m) => 0 < m.stacks.length);
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

  it('separates variables into standard memory segments and registers', () => {
    const code = `
const int readOnlyValue = 1;
int initializedValue = 2;
int zeroInitializedValue;
int helper() { return initializedValue; }
int main(void) {
  register int cached = 3;
  int local = 4;
  int *dynamic = malloc(sizeof(int));
  *dynamic = 5;
  return readOnlyValue + helper() + zeroInitializedValue + cached + local + *dynamic;
}
`;
    const model = modelWith(execute(code), (candidate) => {
      const names = candidate.memory.flatMap((segment) =>
        segment.rows.flatMap((row) => row.map((item) => item.text))
      );
      return names.indexOf('dynamic') !== -1 && names.indexOf('cached') !== -1;
    });
    expect(model.memory.map((segment) => segment.key)).toEqual([
      'registers',
      'text',
      'readOnly',
      'data',
      'bss',
      'heap',
      'stack',
    ]);
    const texts = (key: string) =>
      model.memory
        .find((segment) => segment.key === key)!
        .rows.flatMap((row) => row.map((item) => item.text));
    expect(texts('registers')).toContain('cached');
    expect(texts('registers')).toContain('R0');
    expect(texts('text')).toContain('helper');
    expect(texts('text')).toContain('main');
    expect(texts('readOnly')).toContain('readOnlyValue');
    expect(texts('data')).toContain('initializedValue');
    expect(texts('bss')).toContain('zeroInitializedValue');
    expect(texts('heap').some((text) => text.startsWith('Heap:'))).toBe(true);
    expect(texts('stack')).toEqual(
      expect.arrayContaining(['local', 'dynamic'])
    );
    expect(
      new Set(model.memory.map((segment) => segment.startAddress)).size
    ).toBe(model.memory.length);
  });

  it('expands the statement that is about to run, as plain data', () => {
    const code = `
int main(void) {
  int left = 2;
  int right = 3;
  int result = left + right * 4;
  result = result > 10 ? result - 1 : result + 1;
  return result;
}
`;
    const models = execute(code)
      .map(extractModel)
      .filter((model) => model.expression !== null);
    expect(models.length).toBeGreaterThanOrEqual(2);
    const declaration = models.find(
      (model) => model.expression!.root.kind === 'assignment'
    );
    expect(declaration).toBeDefined();
    expect(declaration!.expression!.root.text).toBe('=');
    expect(declaration!.expression!.root.children[0].text).toBe('result');
    const ternary = models.find((model) => {
      const visit = (node: ExpressionNodeModel): boolean =>
        node.text === '?:' || node.children.some(visit);
      return visit(model.expression!.root);
    });
    expect(ternary).toBeDefined();
    const nodes = (model: StepModel) => {
      const found: ExpressionNodeModel[] = [];
      const visit = (node: ExpressionNodeModel) => {
        found.push(node);
        node.children.forEach(visit);
      };
      visit(model.expression!.root);
      return found;
    };
    // An operator that has not run yet is worth nothing yet; the operands
    // under it are worth what they hold going in.
    expect(nodes(ternary!).some((node) => node.value === null)).toBe(true);
    expect(nodes(ternary!).some((node) => node.value !== null)).toBe(true);
    expect(plain(ternary!.expression)).toBe(true);
  });

  it('expands the statement the editor is highlighting, not the last one', () => {
    const code = `
int twice(int n) {
  return n * 2;
}
int main(void) {
  int a = 1;
  int b = twice(a + 1);
  return b;
}
`;
    const shown = execute(code)
      .map(extractModel)
      .filter((model) => model.expression !== null && model.codeRange !== null);

    expect(shown.length).toBeGreaterThan(0);
    // Every tree belongs to the line under the highlight - including the step
    // that descends into a call, which used to leave the caller's
    // half-evaluated statement on screen against a line inside the callee.
    for (const model of shown) {
      expect(model.expression!.range.begin.y).toBe(model.codeRange!.begin.y);
    }
    const call = shown.find((model) =>
      model.expression!.root.children.some((child) => child.text === 'twice()')
    );
    expect(call).toBeDefined();
    const argument = call!.expression!.root.children[1].children[0];
    expect(argument.text).toBe('+');
    // `a` is in scope and holds 1; the addition has not happened yet.
    expect(argument.children[0]).toMatchObject({ text: 'a', value: '1' });
    expect(argument.value).toBeNull();
  });

  it('expands a call whose arguments are only names or constants', () => {
    // The window used to appear only where a statement held an operator, so
    // `twice(i)` and `twice(3)` - the plainest calls there are - drew nothing.
    // C passes by value, and the copy a call makes of its argument is the
    // misconception this picture exists to answer.
    const code = `
int twice(int n) {
  return n * 2;
}
int main(void) {
  int i = 4;
  int a = twice(i);
  int b = twice(3);
  return a + b;
}
`;
    const roots = execute(code)
      .map(extractModel)
      .filter((model) => model.expression !== null && model.codeRange !== null)
      .map((model) => ({
        line: model.codeRange!.begin.y,
        root: model.expression!.root,
      }));
    const named = roots.find((one) => one.line === 7)!;
    const constant = roots.find((one) => one.line === 8)!;
    expect(named.root.children[1]).toMatchObject({
      text: 'twice()',
      kind: 'operator',
    });
    // The argument is worth what it holds going in, which is the point.
    expect(named.root.children[1].children[0]).toMatchObject({
      text: 'i',
      value: '4',
    });
    expect(constant.root.children[1].children[0]).toMatchObject({
      text: '3',
    });
  });

  it('leaves a declaration with nothing to expand alone', () => {
    // A call earns the window for its arguments; a statement with neither an
    // operator nor a call has no picture to draw, and drawing an empty one
    // would put a window under every line of a program.
    const code = `
int main(void) {
  int i = 0;
  return i;
}
`;
    expect(
      execute(code)
        .map(extractModel)
        .every((model) => model.expression === null)
    ).toBe(true);
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

describe('view options', () => {
  it('leaves a region to the canvas until the reader answers for it', () => {
    const view = new ViewOptions();
    // Nobody has switched this one, so it is drawn if it holds something.
    expect(view.isRegionShown('text', true)).toBe(true);
    expect(view.isRegionShown('text', false)).toBe(false);

    // Once they have, their answer is the answer either way.
    view.showRegion('text', true);
    expect(view.isRegionShown('text', false)).toBe(true);
    view.showRegion('text', false);
    expect(view.isRegionShown('text', true)).toBe(false);

    view.clear();
    expect(view.isRegionShown('text', false)).toBe(false);
  });

  it('shows everything until something is switched off', () => {
    const view = new ViewOptions();
    expect(view.isRegionShown('text')).toBe(true);

    view.toggleRegion('text');
    expect(view.isRegionShown('text')).toBe(false);
    // One region says nothing about the others.
    expect(view.isRegionShown('stack')).toBe(true);

    view.showRegion('text', true);
    expect(view.isRegionShown('text')).toBe(true);
  });

  it('starts a region holding nothing off the map, and opens what it draws', () => {
    expect(startsShown('bss', true)).toBe(true);
    expect(startsShown('bss', false)).toBe(false);
    expect(startsCollapsed('bss', false)).toBe(false);
    expect(startsCollapsed('bss', true)).toBe(true);
  });

  it('names the stack and the heap whatever they hold, and puts them away', () => {
    // The two bands the reader is stepping through the program to watch are
    // on the map before it has put anything in them, as the title bar saying
    // where the first frame and the first allocation will land.
    for (const region of ['stack', 'heap'] as const) {
      expect(startsShown(region, false)).toBe(true);
      expect(startsCollapsed(region, true)).toBe(true);
      expect(startsCollapsed(region, false)).toBe(false);
    }
  });

  it('starts the code and the constants on the map and put away', () => {
    // Neither changes as the program runs, so both are drawn whatever they
    // hold, and neither is opened for holding it.
    for (const region of ['readOnly', 'text'] as const) {
      expect(startsShown(region, false)).toBe(true);
      expect(startsCollapsed(region, false)).toBe(true);
    }
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
      expect(back.model.codeRange).not.toBeNull();
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
    expect(home.model.codeRange).not.toBeNull();
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
      expect(forward.model.codeRange).not.toBeNull();
    }
    // Backward from wherever that ended up.
    for (let step = 0; step < 10; step += 1) {
      const back = await send(server, 'StepBack');
      expect(back.model.codeRange).not.toBeNull();
    }
  });

  it('answers with nothing structuredClone would refuse', async () => {
    const server = new Server();
    // A step carries the model, a syntax check carries the errors, the
    // expansions and the constructs: between them that is every field of a
    // response, and all of them cross the Worker boundary.
    expect(plain(await send(server, 'Start'))).toBe(true);
    expect(plain(await send(server, 'Step'))).toBe(true);
    expect(plain(await send(server, 'SyntaxCheck'))).toBe(true);
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

describe('string literals', () => {
  const code = `
#include <stdio.h>
const char *msg = "hello";
int main(void) {
  printf("%s!\\n", msg);
  return 0;
}
`;
  const model = modelWith(execute(code), (one) => 0 < one.memory.length);
  const readOnly = model.memory.find((segment) => segment.key === 'readOnly')!;
  const texts = readOnly.rows.map((row) =>
    row.map((cell) => cell.text).join(' ')
  );

  it('puts every literal in read-only memory, addressed or not', () => {
    // `const char *p = "hello"` is written into memory by the engine; the
    // format string of a `printf` is passed as bytes and never given an
    // address, and in C both are objects in read-only memory.
    expect(texts.some((row) => row.includes('"hello"'))).toBe(true);
    expect(texts.some((row) => row.includes('"%s!\\n"'))).toBe(true);
  });

  it('counts the terminator in what a literal occupies', () => {
    const hello = readOnly.rows.find((row) =>
      row.some((cell) => cell.text === '"hello"')
    )!;
    const type = hello.find((cell) => cell.kind === 'type')!;

    expect(type.text).toBe('const char[6]');
    expect(type.size).toBe(6);
  });

  it('points the pointer that names one at it', () => {
    const address = readOnly.rows
      .find((row) => row.some((cell) => cell.text === '"hello"'))!
      .find((cell) => cell.kind === 'address')!;

    expect(model.pointers.some((pointer) => pointer.to === address.key)).toBe(
      true
    );
  });
});

describe('alignment', () => {
  const code = `
char flag = 'y';
char label[3] = "ab";
int total = 7;
int main(void) {
  char c = 'z';
  int n = 3;
  char name[5] = "abcd";
  return n;
}
`;
  const model = modelWith(execute(code), (one) => 0 < one.memory.length);

  it('starts every segment on a word', () => {
    for (const segment of model.memory) {
      expect(segment.startAddress % MEMORY_ALIGNMENT).toBe(0);
    }
  });

  it('starts every named object on a word, and packs members as C does', () => {
    const named = model.stacks.flatMap((stack) =>
      stack.rows
        .filter((row) => row[0].kind !== 'indent')
        .map((row) => row.find((cell) => cell.kind === 'address')!)
    );
    expect(named.length).toBeGreaterThan(0);
    for (const cell of named) {
      expect(cell.address! % MEMORY_ALIGNMENT).toBe(0);
    }
    // The bytes of a `char[5]` are five consecutive addresses inside it.
    const members = model.stacks
      .flatMap((stack) => stack.rows)
      .filter((row) => row[0].kind === 'indent')
      .map((row) => row.find((cell) => cell.kind === 'address')!.address!);
    expect(members.length).toBeGreaterThan(1);
    expect(members.some((address) => address % MEMORY_ALIGNMENT !== 0)).toBe(
      true
    );
  });

  it('starts every string literal on a word', () => {
    const readOnly = model.memory.find(
      (segment) => segment.key === 'readOnly'
    )!;
    const addresses = readOnly.rows.map(
      (row) => row.find((cell) => cell.kind === 'address')!.address!
    );

    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) {
      expect(address % MEMORY_ALIGNMENT).toBe(0);
    }
  });
});

describe('the heap after a free', () => {
  // The block that goes is the one in the middle, which is the case that
  // catches this: a hole at the end of the heap closes over nothing.
  const code = `#include<stdio.h>
int main(void) {
  int* first = malloc(sizeof(int) * 2);
  int* second = malloc(sizeof(int) * 2);
  int* third = malloc(sizeof(int) * 2);
  free(second);
  third[0] = 7;
  return 0;
}
`;
  /** The row of the object with this name, wherever on the map it is. */
  const rowNamed = (model: StepModel, name: string): CellModel[] =>
    model.memory
      .flatMap((segment) => segment.rows)
      .find((row) =>
        row.some((cell) => cell.kind === 'name' && cell.text === name)
      )!;
  const valueCell = (model: StepModel, name: string): CellModel =>
    rowNamed(model, name).find((cell) => cell.kind === 'value')!;

  // The step after the `free`: the middle block is gone, and the two either
  // side of it still hold the two integers each was asked for.
  const model = modelWith(
    execute(code),
    (one) =>
      one.memory.find((segment) => segment.key === 'heap')?.rows.length === 4
  );

  it('does not move a block onto the address a freed one left', () => {
    const heap = model.memory.find((segment) => segment.key === 'heap')!;
    const addresses = heap.rows.map(
      (row) => row.find((cell) => cell.kind === 'address')!.address!
    );
    const held = (name: string) => Number(valueCell(model, name).text);

    // `third`'s block keeps the addresses malloc gave it, so the hole where
    // `second`'s block was stays a hole, and no two pointers into the heap
    // read as the same address.
    expect(addresses).toHaveLength(4);
    expect(held('first')).toBe(addresses[0]);
    expect(held('third')).toBe(addresses[2]);
    expect(new Set([held('first'), held('second'), held('third')]).size).toBe(
      3
    );
    // What `second` still holds is in the heap band and is nobody's address.
    expect(addresses).not.toContain(held('second'));
  });

  it('draws no arrow from a pointer to memory that was given back', () => {
    const dangling = valueCell(model, 'second');
    const live = valueCell(model, 'third');

    expect(model.pointers.some((one) => one.from === live.key)).toBe(true);
    expect(model.pointers.some((one) => one.from === dangling.key)).toBe(false);
  });
});

describe('a block malloc has just handed back', () => {
  const code = `#include<stdlib.h>
struct Point { int x; int y; };
int main(void) {
  int* numbers = malloc(sizeof(int) * 2);
  struct Point* point = malloc(sizeof(struct Point));
  numbers[0] = 7;
  (*point).y = 5;
  return 0;
}
`;
  const states = execute(code);
  const models = states.map((state) => extractModel(state));
  /** What every row of the heap band says it holds. */
  const heapValues = (model: StepModel): string[] =>
    model.memory
      .find((segment) => segment.key === 'heap')!
      .rows.map((row) => row.find((cell) => cell.kind === 'value')!.text);
  /** The last step at which the heap holds both of the words written into it. */
  const written = (): StepModel =>
    modelWith(
      states,
      (one) =>
        heapValues(one).indexOf('7') !== -1 &&
        heapValues(one).indexOf('5') !== -1
    );

  it('says the memory is uninitialized rather than showing a number', () => {
    // The two words of the first block, before the program has written into
    // either of them. A number here reads as a value something put in the
    // block, which is the one thing it is not.
    const model = models.find((one) => heapValues(one).length === 2)!;
    expect(heapValues(model)).toEqual(['uninitialized', 'uninitialized']);
  });

  it('holds what the program writes, and says nothing about the rest', () => {
    const values = heapValues(written());
    expect(values).toContain('7');
    expect(values).toContain('5');
    // `numbers[1]` and the record's other member were never written.
    expect(values.filter((text) => text === 'uninitialized')).toHaveLength(2);
  });

  it('leaves a record block able to find its own members', () => {
    // The word a record's block opens with is the address of its members
    // rather than one of them: blank that and the arrow from `point` lands on
    // nothing.
    const model = written();
    const value = model.memory
      .flatMap((segment) => segment.rows)
      .find((row) =>
        row.some((cell) => cell.kind === 'name' && cell.text === 'point')
      )!
      .find((cell) => cell.kind === 'value')!;
    expect(model.pointers.some((one) => one.from === value.key)).toBe(true);
  });
});

describe('values as their type can hold them', () => {
  it('wraps a number to the width and sign of the type it lives in', () => {
    // The engine computes in JavaScript numbers, so an int that was never
    // assigned comes back as the raw bytes: no `int` holds 3909824860.
    expect(narrowToType(3909824860, 'int')).toBe(-385142436);
    expect(narrowToType(3909824860, 'unsigned int')).toBe(3909824860);
    expect(narrowToType(200, 'char')).toBe(-56);
    expect(narrowToType(200, 'unsigned char')).toBe(200);
    expect(narrowToType(70000, 'short')).toBe(4464);
    expect(narrowToType(7, 'int')).toBe(7);
  });

  it('leaves alone what has no fixed width to wrap to', () => {
    expect(narrowToType(1.5, 'double')).toBeNull();
    expect(narrowToType(0.5, 'float')).toBeNull();
    expect(narrowToType(4096, 'int *')).toBeNull();
    expect(narrowToType(4096, 'struct Node')).toBeNull();
    expect(narrowToType(Number.NaN, 'int')).toBeNull();
  });
});

describe('inline values', () => {
  const program = `int main(void) {
  int sum = 0;
  int a[3] = {5, 6, 7};
  for (int i = 0; i < 3; i++) {
    sum += a[i];
  }
  printf("%d\\n", sum);
  return sum;
}
`;
  const states = execute(program);

  /** Every model stopped on the statement that begins on `line`. */
  const modelsOnLine = (line: number): StepModel[] =>
    states
      .map((state) => extractModel(state))
      .filter(
        (model) => model.codeRange !== null && model.codeRange.begin.y === line
      );

  it('names what the statement about to run reads, with what it holds', () => {
    const models = modelsOnLine(5);
    expect(0 < models.length).toBe(true);
    const first = models[0];
    expect(first.inlineValues.map((value) => value.name)).toEqual([
      'sum',
      'a',
      'i',
    ]);
    expect(first.inlineValues[0].display).toBe('0');
    expect(first.inlineValues[2].display).toBe('0');
  });

  it('follows the values as the statement runs again', () => {
    const models = modelsOnLine(5);
    const sums = models.map(
      (model) =>
        model.inlineValues.filter((value) => value.name === 'sum')[0].display
    );
    // The three iterations add 5, 6 and 7 to a sum that starts at nothing.
    expect(sums).toEqual(['0', '5', '11']);
  });

  it('says nothing about the function being called, only its arguments', () => {
    const models = modelsOnLine(7);
    expect(0 < models.length).toBe(true);
    expect(models[0].inlineValues.map((value) => value.name)).toEqual(['sum']);
  });

  it('leaves out a name with no object behind it', () => {
    for (const model of states.map((state) => extractModel(state))) {
      for (const value of model.inlineValues) {
        expect(model.variables.some((one) => one.name === value.name)).toBe(
          true
        );
      }
    }
  });
});
