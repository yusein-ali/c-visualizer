import {
  CONTROL_EVENT,
  Response,
  Server,
  StepModel,
  VariableModel,
} from '../src/core';

/**
 * Block-scope declarations that name an object outliving the call: `static`
 * and `extern` inside a function.
 *
 * Both used to run where they were written, as a fresh local. A `static`
 * restarted at every call and left the data segment when its function
 * returned; an `extern` gave the function a zero-filled copy to write to while
 * the file-scope object kept its value.
 */

const quiet = async (run: () => Promise<Response>): Promise<Response> => {
  const logged = console.log;
  console.log = () => undefined;
  try {
    return await run();
  } finally {
    console.log = logged;
  }
};

/** Every response of a run stepped from Start to its end. */
const stepThrough = async (text: string): Promise<Response[]> => {
  const server = new Server();
  const files = [{ path: 'main.c', text }];
  const send = (controlEvent: CONTROL_EVENT) =>
    quiet(() =>
      server.send({
        controlEvent,
        sourcecode: text,
        files,
        entry: 'main.c',
        active: 'main.c',
      })
    );
  const responses = [await send('Start')];
  let last = responses[0];
  while (
    last.debugState !== 'EOF' &&
    last.debugState !== 'Stop' &&
    responses.length < 500
  ) {
    last = await send('Step');
    responses.push(last);
  }
  return responses;
};

/** The rows of one memory segment, as `name = value @ address`. */
const segment = (model: StepModel, key: string): string[] =>
  model.memory
    .find((one) => one.key === key)!
    .rows.map((row) => {
      const text = (kind: string) =>
        row.find((cell) => cell.kind === kind)?.text ?? '';
      const address = row.find((cell) => cell.kind === 'address')?.address;
      return `${text('name')} = ${text('value')} @ ${address}`;
    });

const counter = `#include <stdio.h>
int tick(void) {
  static int calls = 0;
  static int seen;
  calls++;
  seen += 2;
  return calls;
}
int main(void) {
  int a = tick();
  int b = tick();
  int c = tick();
  printf("%d %d %d\\n", a, b, c);
  return 0;
}
`;

describe('a block-scope static', () => {
  it('keeps its value from one call to the next', async () => {
    const responses = await stepThrough(counter);
    expect(responses[responses.length - 1].output).toBe('1 2 3\n');
  });

  it('is in its segment from the first step, once, at one address', async () => {
    const responses = await stepThrough(counter);
    const [first] = responses;
    expect(segment(first.model, 'data')).toEqual([
      expect.stringMatching(/^calls = 0 @ \d+$/),
    ]);
    expect(segment(first.model, 'bss')).toEqual([
      expect.stringMatching(/^seen = 0 @ \d+$/),
    ]);
    const addressOf = (model: StepModel, key: string) =>
      segment(model, key)[0].split(' @ ')[1];
    for (const response of responses) {
      expect(segment(response.model, 'data')).toHaveLength(1);
      expect(segment(response.model, 'bss')).toHaveLength(1);
      expect(addressOf(response.model, 'data')).toBe(
        addressOf(first.model, 'data')
      );
      expect(addressOf(response.model, 'bss')).toBe(
        addressOf(first.model, 'bss')
      );
      // Not drawn a second time in the frame of the call that names it.
      expect(
        segment(response.model, 'stack').some((row) =>
          /^(calls|seen) /.test(row)
        )
      ).toBe(false);
    }
    const last = responses[responses.length - 1].model;
    expect(segment(last, 'data')[0]).toMatch(/^calls = 3 /);
    expect(segment(last, 'bss')[0]).toMatch(/^seen = 6 /);
  });

  it('does not share an address with the stack', async () => {
    const responses = await stepThrough(counter);
    const last = responses[responses.length - 1].model;
    const statics = [...segment(last, 'data'), ...segment(last, 'bss')].map(
      (row) => row.split(' @ ')[1]
    );
    for (const row of segment(last, 'stack')) {
      expect(statics).not.toContain(row.split(' @ ')[1]);
    }
  });

  it('is one object to every activation of a recursive function', async () => {
    const responses = await stepThrough(`#include <stdio.h>
int fact(int n) {
  static int depth;
  depth++;
  return n <= 1 ? 1 : n * fact(n - 1);
}
int main(void) {
  int f = fact(4);
  printf("%d %d\\n", f, 0);
  return 0;
}
`);
    const last = responses[responses.length - 1].model;
    expect(segment(last, 'bss')[0]).toMatch(/^depth = 4 /);
  });

  it('is told apart from a same-named static or global elsewhere', async () => {
    const responses = await stepThrough(`#include <stdio.h>
int count = 100;
int first(void) { static int count; return ++count; }
int second(void) { static int count = 10; return ++count; }
int main(void) {
  first();
  first();
  second();
  printf("%d %d %d\\n", count, first(), second());
  return 0;
}
`);
    const last = responses[responses.length - 1];
    expect(last.output).toBe('100 3 12\n');
    const counts = last.model.variables.filter(
      (variable) => variable.name === 'count'
    );
    // Keyed by the function that names each one, which is also where
    // go-to-declaration looks for it.
    expect(counts.map((variable) => variable.key).sort()).toEqual([
      'GLOBAL-count',
      'first-count',
      'second-count',
    ]);
    const keys = last.model.memory.flatMap((one) =>
      one.rows.flatMap((row) =>
        row.filter((cell) => cell.kind === 'name').map((cell) => cell.key)
      )
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is the name its function means, and only while it runs', async () => {
    const responses = await stepThrough(`int count = 100;
int first(void) {
  static int count = 7;
  return count;
}
int main(void) {
  int seen = first();
  return seen;
}
`);
    /** What a reader hovering `count` is told: the innermost match. */
    const named = (variables: VariableModel[]) =>
      variables.filter((variable) => variable.name === 'count').pop()!;
    const inside = responses.find(
      (response) => response.model.context.function === 'first'
    )!.model;
    expect(named(inside.variables)).toMatchObject({
      key: 'first-count',
      frame: 'first',
      active: true,
      region: 'data',
    });
    const outside = responses[responses.length - 1].model;
    expect(named(outside.variables).key).toBe('GLOBAL-count');
    expect(
      outside.variables.find((variable) => variable.key === 'first-count')
    ).toMatchObject({ active: false });
  });

  it('runs an initializer that is not constant where it is written', async () => {
    // C refuses `static int x = f();`; the interpreter keeps running it per
    // call, as it always did, rather than calling `f` before `main`.
    const responses = await stepThrough(`#include <stdio.h>
int seed(void) { return 5; }
int next(void) {
  static int x = seed();
  return ++x;
}
int main(void) {
  printf("%d\\n", next());
  return 0;
}
`);
    expect(responses[responses.length - 1].output).toBe('6\n');
  });
});

describe('a block-scope extern', () => {
  it('names the file-scope object rather than a copy of it', async () => {
    const responses = await stepThrough(`#include <stdio.h>
int shared = 3;
void bump(void) {
  extern int shared;
  shared++;
}
int main(void) {
  bump();
  bump();
  printf("%d\\n", shared);
  return 0;
}
`);
    const last = responses[responses.length - 1];
    expect(last.output).toBe('5\n');
    expect(segment(last.model, 'data')).toEqual([
      expect.stringMatching(/^shared = 5 @ \d+$/),
    ]);
  });
});
