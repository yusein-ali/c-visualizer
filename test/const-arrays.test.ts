import { CONTROL_EVENT, Response, Server, StepModel } from '../src/core';

/**
 * `const` arrays: a write to an element is refused as gcc refuses it, and the
 * canvas draws the array, its rows and its elements as `const`.
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
    responses.length < 1000
  ) {
    last = await send('Step');
    responses.push(last);
  }
  return responses;
};

/** What the run printed, and its last step's model with anything drawn. */
const run = async (
  text: string
): Promise<{ output: string; model: StepModel }> => {
  const responses = await stepThrough(text);
  const drawn = responses.filter((response) =>
    response.model.memory.some((segment) => segment.rows.length > 0)
  );
  return {
    output: responses[responses.length - 1].output,
    model: drawn[drawn.length - 1].model,
  };
};

/** The rows of one memory segment, as `type name @ address`. */
const rows = (model: StepModel, key: string): string[] =>
  model.memory
    .find((one) => one.key === key)!
    .rows.map((row) => {
      const text = (kind: string) =>
        row.find((cell) => cell.kind === kind)?.text ?? '';
      const address = row.find((cell) => cell.kind === 'address')?.address;
      return `${text('type')} ${text('name')} @ ${address}`;
    });

/** The type a segment's row for `name` is drawn with. */
const typeOf = (model: StepModel, key: string, name: string): string => {
  const row = rows(model, key).find((one) =>
    one.split(' @ ')[0].endsWith(` ${name}`)
  );
  if (typeof row === 'undefined') {
    throw new Error(`${name} is not drawn in ${key}`);
  }
  return row.split(' @ ')[0].slice(0, -name.length - 1);
};

const refusal = (line: number): string =>
  `c-visualizer stopped the program on line ${line}: ` +
  'the assignment attempts to modify a const-qualified object\n';

describe('a const array of more than one dimension', () => {
  it('refuses a write to an element, as it refuses one of one', async () => {
    const one = await run(`#include <stdio.h>
int main(void) {
  const int row[3] = {1, 2, 3};
  row[2] = 5;
  return 0;
}
`);
    expect(one.output).toBe(refusal(4));
    const two = await run(`#include <stdio.h>
int main(void) {
  const int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  printf("%d %d\\n", grid[0][0], grid[1][2]);
  grid[1][2] = 5;
  printf("%d\\n", grid[1][2]);
  return 0;
}
`);
    expect(two.output).toBe('1 6\n' + refusal(5));
  });

  it('refuses a write to any element, and reads every one', async () => {
    const { output } = await run(`#include <stdio.h>
int main(void) {
  const int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int sum = 0;
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 3; j++) {
      sum += grid[i][j];
    }
  }
  printf("%d\\n", sum);
  grid[0][0] = 9;
  return 0;
}
`);
    expect(output).toBe('21\n' + refusal(11));
  });

  it('is still drawn as const, rows and elements included', async () => {
    const { model } = await run(`#include <stdio.h>
int main(void) {
  const int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  printf("%d\\n", grid[1][2]);
  return 0;
}
`);
    expect(typeOf(model, 'stack', 'grid')).toBe('const int[2][3]');
    expect(typeOf(model, 'stack', 'grid[1]')).toBe('const int[3]');
    expect(typeOf(model, 'stack', 'grid[1][2]')).toBe('const int');
  });

  it('refuses a write to an element of three dimensions', async () => {
    const { output, model } = await run(`#include <stdio.h>
const int cube[2][2][2] = {{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}};
int main(void) {
  printf("%d\\n", cube[1][0][1]);
  cube[1][0][1] = 3;
  return 0;
}
`);
    expect(output).toBe('6\n' + refusal(5));
    expect(typeOf(model, 'readOnly', 'cube')).toBe('const int[2][2][2]');
  });

  it('refuses a write to a block-scope static one', async () => {
    const { output } = await run(`#include <stdio.h>
int main(void) {
  static const char names[2][4] = {"ann", "bob"};
  printf("%s\\n", names[1]);
  names[1][0] = 'r';
  return 0;
}
`);
    expect(output).toBe('bob\n' + refusal(5));
  });

  it('refuses a library function writing to it', async () => {
    const { output } = await run(`#include <stdio.h>
#include <string.h>
int main(void) {
  const char names[2][4] = {"ann", "bob"};
  strcpy((char *)names[1], "cy");
  return 0;
}
`);
    expect(output).toBe(
      'c-visualizer stopped the program on line 5: ' +
        'strcpy attempts to modify a const-qualified object\n'
    );
  });

  it('leaves an array that is not const writable', async () => {
    const { output, model } = await run(`#include <stdio.h>
int main(void) {
  int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int cube[2][2][2] = {{{1, 2}, {3, 4}}, {{5, 6}, {7, 8}}};
  grid[1][2] = 9;
  cube[1][1][0] = 10;
  printf("%d %d\\n", grid[1][2], cube[1][1][0]);
  return 0;
}
`);
    expect(output).toBe('9 10\n');
    expect(typeOf(model, 'stack', 'grid')).toBe('int[2][3]');
    expect(typeOf(model, 'stack', 'grid[1][2]')).toBe('int');
  });

  it('refuses a write to a const array of records', async () => {
    const { output } = await run(`#include <stdio.h>
struct point { int x; int y; };
int main(void) {
  const struct point corners[2] = {{1, 2}, {3, 4}};
  printf("%d\\n", corners[1].y);
  corners[1].y = 5;
  return 0;
}
`);
    expect(output).toBe('4\n' + refusal(6));
  });
});

/**
 * An array whose length comes from its initializer - `const char greeting[]
 * = "hi";`, `const int primes[] = {2, 3, 5};` - has a declarator of `[]`,
 * which gives no length to count its elements with. Nothing of its
 * declaration was filed on them: it was drawn without its `const`, a
 * file-scope one in data rather than in the read-only band, and a write to
 * it ran.
 */
describe('a const array sized by its initializer', () => {
  const at = (model: StepModel, key: string, name: string): number =>
    Number(
      rows(model, key)
        .find((one) => one.split(' @ ')[0].endsWith(` ${name}`))!
        .split(' @ ')[1]
    );

  const literals = (model: StepModel): number[] =>
    rows(model, 'readOnly')
      .filter((one) => / _unnamed_cs_\d+ @/.test(one))
      .map((one) => Number(one.split(' @ ')[1]));

  it('is read-only data at file scope, after the literals', async () => {
    const { output, model } = await run(`#include <stdio.h>
const char greeting[] = "hi";
int main(void) { printf("%s\\n", greeting); return 0; }
`);
    expect(output).toBe('hi\n');
    expect(typeOf(model, 'readOnly', 'greeting')).toBe('const char[3]');
    expect(typeOf(model, 'readOnly', 'greeting[0]')).toBe('const char');
    expect(at(model, 'readOnly', 'greeting')).toBeGreaterThan(
      Math.max(...literals(model))
    );
    expect(at(model, 'readOnly', 'greeting')).toBeLessThan(0x3000);
    expect(rows(model, 'data')).toEqual([]);
  });

  it('refuses a write through a cast, as a sized one does', async () => {
    const sized = await run(`#include <stdio.h>
const char greeting[3] = "hi";
int main(void) {
  ((char *)greeting)[0] = 'H';
  return 0;
}
`);
    expect(sized.output).toBe(refusal(4));
    const unsized = await run(`#include <stdio.h>
const char greeting[] = "hi";
int main(void) {
  ((char *)greeting)[0] = 'H';
  printf("%s\\n", greeting);
  return 0;
}
`);
    expect(unsized.output).toBe(refusal(4));
  });

  it('is read-only data as a block-scope static', async () => {
    const { output, model } = await run(`#include <stdio.h>
void greet(void) {
  static const char name[] = "x";
  printf("%s\\n", name);
}
int main(void) {
  greet();
  return 0;
}
`);
    expect(output).toBe('x\n');
    // Spelled with its storage class, as a sized one is.
    expect(typeOf(model, 'readOnly', 'name')).toBe('static const char[2]');
    expect(rows(model, 'data')).toEqual([]);
    const write = await run(`#include <stdio.h>
void greet(void) {
  static const char name[] = "x";
  ((char *)name)[0] = 'y';
}
int main(void) {
  greet();
  return 0;
}
`);
    expect(write.output).toBe(refusal(4));
  });

  it('refuses a write to a local one', async () => {
    const text = await run(`#include <stdio.h>
int main(void) {
  const char s[] = "hi";
  printf("%s\\n", s);
  s[0] = 'H';
  return 0;
}
`);
    expect(text.output).toBe('hi\n' + refusal(5));
    expect(typeOf(text.model, 'stack', 's')).toBe('const char[3]');
    const numbers = await run(`#include <stdio.h>
int main(void) {
  const int primes[] = {2, 3, 5};
  const int grid[][2] = {{1, 2}, {3, 4}};
  printf("%d %d\\n", primes[2], grid[1][1]);
  grid[1][0] = 7;
  return 0;
}
`);
    expect(numbers.output).toBe('5 4\n' + refusal(6));
    expect(typeOf(numbers.model, 'stack', 'primes')).toBe('const int[3]');
    expect(typeOf(numbers.model, 'stack', 'grid')).toBe('const int[2][2]');
  });

  it('leaves one that is not const writable, in data', async () => {
    const { output, model } = await run(`#include <stdio.h>
char greeting[] = "hi";
int main(void) {
  greeting[0] = 'H';
  printf("%s\\n", greeting);
  return 0;
}
`);
    expect(output).toBe('Hi\n');
    expect(typeOf(model, 'data', 'greeting')).toBe('char[3]');
  });

  it('leaves a pointer to a literal a pointer that can be moved', async () => {
    const { output, model } = await run(`#include <stdio.h>
const char *p = "x";
int main(void) {
  p = "y";
  printf("%s\\n", p);
  return 0;
}
`);
    expect(output).toBe('y\n');
    expect(typeOf(model, 'data', 'p')).toBe('const char *');
  });
});
