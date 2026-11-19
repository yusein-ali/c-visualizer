import { CellModel, Response, Server, StepModel } from '../src/core';

/**
 * No two live objects at one address, at any step.
 *
 * The engine packs the stack band as C packs a structure's members - a `char`
 * is one byte and the next object sits beside it - and the canvas starts
 * every named object on a word. A frame drawn with that padding ends past
 * where the engine ended it, and the next frame starts where the engine put
 * it: `char c` in `main` and the first parameter of the function it called
 * had one address, and so did the last string of the program's arguments
 * and `argc`, whose arrow then pointed into `main`'s frame.
 */

const quiet = async <T>(work: () => Promise<T>): Promise<T> => {
  const logged = console.log;
  console.log = () => undefined;
  try {
    return await work();
  } finally {
    console.log = logged;
  }
};

/** Every model of a run, stepped from Start to its end. */
const stepsOf = async (code: string, args?: string[]): Promise<Response[]> => {
  const server = new Server();
  const request = {
    sourcecode: code,
    files: [{ path: 'main.c', text: code }],
    entry: 'main.c',
    ...(typeof args === 'undefined' ? {} : { args }),
  };
  return quiet(async () => {
    const responses = [
      await server.send({ ...request, controlEvent: 'Start' }),
    ];
    let last = responses[0];
    while (
      last.debugState !== 'EOF' &&
      last.debugState !== 'Stop' &&
      responses.length < 400
    ) {
      last = await server.send({ ...request, controlEvent: 'Step' });
      responses.push(last);
    }
    return responses;
  });
};

/** The objects of a step that share a byte, as `frame.name ~ frame.name`. */
const overlaps = (model: StepModel): string[] => {
  const objects = model.variables.filter(
    (variable) => variable.region !== 'text' && variable.region !== 'readOnly'
  );
  const found: string[] = [];
  objects.forEach((one, index) => {
    for (const other of objects.slice(index + 1)) {
      const oneEnd = one.address + (one.size ?? 1);
      const otherEnd = other.address + (other.size ?? 1);
      if (one.address < otherEnd && other.address < oneEnd) {
        found.push(`${one.frame}.${one.name} ~ ${other.frame}.${other.name}`);
      }
    }
  });
  return found;
};

const rowsOf = (model: StepModel): CellModel[][] =>
  model.stacks.flatMap((stack) => stack.rows);

/** The address cell a pointer's arrow lands on, and the name of its row. */
const arrowsOf = (model: StepModel): { from: string; to: string }[] =>
  model.pointers.map((pointer) => {
    const row = rowsOf(model).find((cells) =>
      cells.some((cell) => cell.key === pointer.to)
    );
    const name = row?.find((cell) => cell.kind === 'name')?.text ?? '?';
    return { from: pointer.from, to: name };
  });

/** Every step of a run has its objects apart. */
const expectApart = (responses: Response[]): void => {
  for (const response of responses) {
    expect(overlaps(response.model)).toEqual([]);
  }
};

/** The deepest step: the one with the most frames on the stack. */
const deepest = (responses: Response[]): StepModel =>
  responses
    .map((response) => response.model)
    .reduce((best, model) =>
      model.stacks.length > best.stacks.length ? model : best
    );

const addressOf = (model: StepModel, frame: string, name: string): number =>
  model.variables.find(
    (variable) => variable.frame === frame && variable.name === name
  )!.address;

describe('a called function', () => {
  it("starts its frame after the caller's last char, not on it", async () => {
    const responses = await stepsOf(`#include <stdio.h>
int add(int a, int b) { return a + b; }
int main(void) {
  int n = 5;
  char c = 'x';
  printf("%d\\n", add(n, c));
  return 0;
}`);
    expectApart(responses);
    const model = deepest(responses);
    expect(addressOf(model, 'add', 'a')).toBeGreaterThanOrEqual(
      addressOf(model, 'main', 'c') + 1
    );
    expect(addressOf(model, 'add', 'a') % 4).toBe(0);
  });

  it('keeps apart from char, short and odd-length char array locals', async () => {
    expectApart(
      await stepsOf(`#include <stdio.h>
#include <stdarg.h>
int total(int count, ...) {
  va_list ap;
  int sum = 0;
  va_start(ap, count);
  for (int i = 0; i < count; i++) sum += va_arg(ap, int);
  va_end(ap);
  return sum;
}
int main(void) {
  char c = 'x';
  short s = 2;
  char d = 'y';
  char word[5] = "abcd";
  char odd[3] = "ab";
  float f = 1.5f;
  printf("%d %c%c%s%s %.1f\\n", total(3, c, s, d), c, d, word, odd, f);
  return 0;
}`)
    );
  });

  it('keeps apart from a structure whose last member is a char', async () => {
    expectApart(
      await stepsOf(`#include <stdio.h>
struct tagged { int value; char tag; };
int twice(int v) { return 2 * v; }
int main(void) {
  struct tagged t = {4, 'q'};
  printf("%d %c\\n", twice(t.value), t.tag);
  return 0;
}`)
    );
  });

  it('keeps every frame of a recursion apart', async () => {
    const responses = await stepsOf(`#include <stdio.h>
int depth(char mark, int n) {
  char here = mark;
  return n == 0 ? here : depth(here + 1, n - 1);
}
int main(void) {
  char start = 'a';
  printf("%c\\n", depth(start, 3));
  return 0;
}`);
    expectApart(responses);
    expect(responses[responses.length - 1].output).toBe('d\n');
  });

  it('prints with %p the addresses it draws', async () => {
    const responses = await stepsOf(`#include <stdio.h>
void show(int a) { printf("%p\\n", (void *)&a); }
int main(void) {
  int n = 5;
  char c = 'x';
  printf("%p %p\\n", (void *)&n, (void *)&c);
  show(n);
  return 0;
}`);
    const model = deepest(responses);
    const printed = responses[responses.length - 1].output
      .trim()
      .split(/\s+/)
      .map((text) => Number.parseInt(text, 16));
    expect(printed).toEqual([
      addressOf(model, 'main', 'n'),
      addressOf(model, 'main', 'c'),
      addressOf(model, 'show', 'a'),
    ]);
  });
});

describe("main's arguments", () => {
  const program = `#include <stdio.h>
int main(int argc, char *argv[]) {
  for (int i = 0; i < argc; i++) {
    printf("[%s]", argv[i]);
  }
  printf("\\n");
  return 0;
}`;

  it.each([
    [[]],
    [['x']],
    [['Dune', '1965']],
    [['a', 'bb', 'ccc', 'dddd', 'eeeee']],
    [['two words', '1965']],
  ])('lie apart from main and point at their strings: %j', async (args) => {
    const responses = await stepsOf(program, args);
    expectApart(responses);
    const last = responses[responses.length - 1];
    expect(last.output).toBe(
      `[main]${args.map((arg) => `[${arg}]`).join('')}\n`
    );
    const model = deepest(responses);
    const arrows = arrowsOf(model);
    args.forEach((_, index) => {
      // `_argv[i]` points at the first character of `_argv_i`.
      expect(arrows).toContainEqual({
        from: expect.stringContaining(`_argv[${index + 1}]`),
        to: `_argv_${index + 1}[0]`,
      });
    });
    expect(arrows.filter(({ to }) => to === 'argc')).toEqual([]);
    expect(addressOf(model, 'main', 'argc')).toBeGreaterThanOrEqual(
      Math.max(
        ...model.variables
          .filter((variable) => variable.frame === 'GLOBAL')
          .map((variable) => variable.address + (variable.size ?? 1))
      )
    );
  });
});
