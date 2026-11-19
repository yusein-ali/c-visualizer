import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { PlivetCPP14Engine } from '../src/interpreter/CPP14Engine';

/**
 * A program's own typedef of a narrow type has its C width in the engine's
 * memory, as `<stdint.h>`'s do.
 *
 * unicoen sizes everything through one class-level hook that is given a type
 * spelling and nothing else, and PLIVET's hook knew the built-in and library
 * names only: `typedef unsigned char byte;` was four bytes to the engine. A
 * `byte buf[4]` was laid out four bytes to an element, and `memset` over it
 * wrote one cell in four. A heap block a `byte *` is given was already typed
 * byte by byte (`layOutHeapScalars` resolves the pointee's typedef); it is
 * checked here so that it stays so.
 */

interface Run {
  output: string;
  states: ExecState[];
}

const quietly = <T>(work: () => T): T => {
  const log = console.log;
  console.log = () => undefined;
  try {
    return work();
  } finally {
    console.log = log;
  }
};

/** Starts a run; `step` advances it, and says whether it is still going. */
const start = (
  code: string,
  interpreter: PlivetCPP14Interpreter = new PlivetCPP14Interpreter()
) => {
  interpreter.setFileList(new Map());
  const states: ExecState[] = [
    quietly(() => interpreter.startStepExecution(code)),
  ];
  return {
    states,
    step: (): boolean => {
      if (!interpreter.isStepExecutionRunning() || states.length > 20000) {
        return false;
      }
      states.push(quietly(() => interpreter.stepExecute()));
      return true;
    },
    output: () => interpreter.getStdout(),
  };
};

const execute = (
  code: string,
  interpreter: PlivetCPP14Interpreter = new PlivetCPP14Interpreter()
): Run => {
  const run = start(code, interpreter);
  while (run.step()) {
    // Stepped to the end.
  }
  return { output: run.output(), states: run.states };
};

/** The engine addresses of an array's elements, at the last step it lives. */
const elementAddresses = (states: ExecState[], name: string): number[] => {
  for (let i = states.length - 1; i >= 0; i -= 1) {
    for (const stack of states[i].getStacks()) {
      const variable = stack
        .getVariables()
        .find((item: Variable) => item.name === name);
      if (typeof variable !== 'undefined') {
        return (variable.getValue() as Variable[]).map((item) => item.address);
      }
    }
  }
  throw new Error(`${name} was not visualized`);
};

/** How many cells the engine typed in each heap block, at some step. */
const heapCells = (states: ExecState[]): number =>
  Math.max(
    ...states.map(
      (state) =>
        state
          .getStacks()
          .flatMap((stack) => stack.getVariables())
          .filter((variable: Variable) => variable.name.startsWith('Heap:'))
          .length
    )
  );

const BYTES = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef unsigned char byte;
typedef byte octet;
typedef short half;
int main(void) {
  byte buf[4];
  memset(buf, 0xAB, sizeof buf);
  printf("%zu %zu %zu %zu\\n", sizeof(byte), sizeof buf, sizeof(octet), sizeof(half));
  printf("%d %d %d %d\\n", buf[0], buf[1], buf[2], buf[3]);
  byte copy[4] = {0, 0, 0, 0};
  memset(buf + 1, 7, 2);
  memcpy(copy, buf, sizeof copy);
  printf("%d %d %d %d\\n", copy[0], copy[1], copy[2], copy[3]);
  byte *b = malloc(8);
  for (int i = 0; i < 8; i++) {
    b[i] = i * 3;
  }
  byte *q = b + 5;
  printf("%d %d %d %d\\n", *q, q[2], (int)(q - b), (int)((char *)(b + 2) - (char *)b));
  octet o[3];
  memset(o, 1, sizeof o);
  half hs[3];
  memset(hs, 1, sizeof hs);
  printf("%d %d %d\\n", o[0] + o[1] + o[2], hs[0], hs[2]);
  free(b);
  return 0;
}
`;

const BYTES_OUTPUT =
  '1 4 1 2\n171 171 171 171\n171 7 7 171\n15 21 5 2\n3 257 257\n';

describe("a program's own typedef of a narrow type", () => {
  it('sizes, fills, copies and steps a byte array by bytes', () => {
    expect(execute(BYTES).output).toBe(BYTES_OUTPUT);
  });

  it('lays out the elements of its arrays one width apart', () => {
    const { states } = execute(BYTES);
    const step = (addresses: number[]) =>
      addresses.slice(1).map((address, at) => address - addresses[at]);
    expect(step(elementAddresses(states, 'buf'))).toEqual([1, 1, 1]);
    expect(step(elementAddresses(states, 'o'))).toEqual([1, 1]);
    expect(step(elementAddresses(states, 'hs'))).toEqual([2, 2]);
  });

  it('gives a byte block from malloc one element per byte', () => {
    const { output, states } = execute(`#include <stdio.h>
#include <stdlib.h>
typedef unsigned char byte;
int main(void) {
  byte *b = malloc(8);
  b[7] = 9;
  printf("%d\\n", b[7]);
  free(b);
  return 0;
}
`);
    expect(output).toBe('9\n');
    expect(heapCells(states)).toBe(8);
  });

  it('gives a block of a typedef of a typedef one element per byte', () => {
    const { output, states } = execute(`#include <stdio.h>
#include <stdlib.h>
typedef unsigned char byte;
typedef byte octet;
int main(void) {
  octet *o;
  o = (octet *)malloc(8);
  o[7] = 9;
  printf("%d\\n", o[7]);
  free(o);
  return 0;
}
`);
    expect(output).toBe('9\n');
    expect(heapCells(states)).toBe(8);
  });

  it('follows a typedef declared in a function', () => {
    expect(
      execute(`#include <stdio.h>
#include <string.h>
void fill(void) {
  typedef short wide;
  wide w[3];
  memset(w, 1, sizeof w);
  printf("%d %d %d %zu\\n", w[0], w[1], w[2], sizeof w);
}
int main(void) {
  fill();
  return 0;
}
`).output
    ).toBe('257 257 257 6\n');
  });

  it('leaves a typedef of a structure sized as it was', () => {
    expect(
      execute(`#include <stdio.h>
#include <stdlib.h>
typedef unsigned char byte;
typedef struct { int x; int y; } Point;
typedef struct node { byte tag; struct node *next; } Node;
int main(void) {
  Point corners[2] = {{1, 2}, {3, 4}};
  Point *p = malloc(sizeof(Point));
  p->x = corners[1].y;
  p->y = 6;
  Node second = {200, NULL};
  Node first = {7, &second};
  printf("%d %d %zu %zu\\n", p->x, p->y, sizeof(Point), sizeof corners);
  printf("%d %d %zu\\n", first.tag, first.next->tag, sizeof(Node));
  free(p);
  return 0;
}
`).output
    ).toBe('4 6 8 16\n7 200 8\n');
  });

  it('keeps the narrow members of a record where the canvas reads them', () => {
    const { output, states } = execute(`#include <stdio.h>
#include <stdint.h>
#include <string.h>
typedef unsigned char byte;
struct packet { byte data[4]; int n; byte tag; };
union word { uint32_t whole; byte b[4]; };
int main(void) {
  struct packet p;
  p.n = 77;
  p.tag = 5;
  memset(p.data, 0xAB, sizeof p.data);
  p.data[2] = 1;
  union word w;
  w.whole = 0x01020304;
  printf("%d %d %d %d %d %zu\\n", p.data[0], p.data[2], p.data[3], p.n, p.tag, sizeof p);
  printf("%d %d\\n", w.b[0], w.b[3]);
  w.b[1] = 0xff;
  struct packet copy = p;
  printf("%x %d %d\\n", w.whole, copy.data[2], copy.n);
  return 0;
}
`);
    expect(output).toBe('171 1 171 77 5 12\n4 1\n102ff04 1 77\n');
    const last = states[states.length - 1];
    const p = last
      .getStacks()
      .flatMap((stack) => stack.getVariables())
      .find((variable: Variable) => variable.name === 'p')!;
    const data = (p.getValue() as Variable[]).find(
      (member) => member.name === 'data'
    )!;
    expect(
      (data.getValue() as Variable[]).map((element) =>
        Number(element.getValue())
      )
    ).toEqual([171, 171, 1, 171]);
  });

  it('keeps a pointer typedef four bytes wide', () => {
    expect(
      execute(`#include <stdio.h>
typedef unsigned char byte;
typedef byte *bytes;
int main(void) {
  byte data[3] = {1, 2, 3};
  bytes list[2] = {data, data + 2};
  printf("%zu %d %d\\n", sizeof list, *list[0], *list[1]);
  return 0;
}
`).output
    ).toBe('8 1 3\n');
  });
});

/**
 * The library reads and writes a typed cell as the bytes C stores for it,
 * and whether those bytes are an integer, signed or not, or a floating
 * value, it read off the type's spelling - which for `real` is a name. A
 * `memcpy` of a `typedef double real` array copied 2.0 for 2.5.
 */
describe("the bytes of a program's own typedef in the library", () => {
  it('copies, moves, fills and compares them as gcc does', () => {
    expect(
      execute(`#include <stdio.h>
#include <string.h>
typedef double real;
typedef real measure;
typedef float ratio;
typedef unsigned short word;
typedef signed char tiny;
int main(void) {
  real r[3] = {1.5, 2.5, -3.25};
  real r2[3];
  memcpy(r2, r, sizeof r);
  measure m[3];
  memmove(m, r2, sizeof m);
  memmove(m + 1, m, 2 * sizeof(measure));
  printf("%.2f %.2f %.2f | %.2f %.2f %.2f\\n", r2[0], r2[1], r2[2], m[0], m[1], m[2]);
  ratio f[2] = {0.75f, -2.5f};
  ratio g[2];
  memcpy(g, f, sizeof f);
  printf("%.2f %.2f\\n", g[0], g[1]);
  word w[3];
  memset(w, 0xff, sizeof w);
  word w2[3] = {1, 2, 3};
  memcpy(w2, w, 2 * sizeof(word));
  printf("%u %u %u %d\\n", w[0], w2[1], w2[2], w[2] + 1);
  tiny t[3];
  memset(t, 0xff, sizeof t);
  tiny t2[3] = {5, 6, 7};
  memmove(t2 + 1, t, 2);
  printf("%d %d %d %d\\n", t[0], t2[0], t2[1], t2[2]);
  real z[2] = {9.0, 9.0};
  memset(z, 0, sizeof z);
  printf("%.1f %.1f\\n", z[0], z[1] + 0.5);
  printf("%d %d %d %d\\n", memcmp(r, r2, sizeof r) == 0, memcmp(r, m, sizeof r) < 0,
         memcmp(w, w2, sizeof w) > 0, memcmp(t, t2, sizeof t) > 0);
  return 0;
}
`).output
    ).toBe(
      '1.50 2.50 -3.25 | 1.50 1.50 2.50\n0.75 -2.50\n65535 65535 3 65536\n' +
        '-1 5 -1 -1\n0.0 0.5\n1 1 1 1\n'
    );
  });

  it('copies a typedef declared in a function', () => {
    expect(
      execute(`#include <stdio.h>
#include <string.h>
void copy(void) {
  typedef double real;
  real from[2] = {0.25, -8.5};
  real to[2];
  memcpy(to, from, sizeof from);
  printf("%.2f %.2f\\n", to[0], to[1]);
}
int main(void) {
  copy();
  return 0;
}
`).output
    ).toBe('0.25 -8.50\n');
  });

  it('fills a block from calloc with zeros of its type', () => {
    expect(
      execute(`#include <stdio.h>
#include <stdlib.h>
typedef double real;
int main(void) {
  real *r = calloc(2, sizeof(real));
  r[1] += 0.5;
  printf("%.2f %.2f\\n", r[0] / 4, r[1] / 4);
  free(r);
  return 0;
}
`).output
    ).toBe('0.00 0.12\n');
  });
});

describe('the sizes of one run', () => {
  it('are the same in a second run of the same interpreter', () => {
    const interpreter = new PlivetCPP14Interpreter();
    expect(execute(BYTES, interpreter).output).toBe(BYTES_OUTPUT);
    expect(execute(BYTES, interpreter).output).toBe(BYTES_OUTPUT);
  });

  it('survive the engine the library names are read from', () => {
    PlivetCPP14Engine.libraryFunctionNames();
    expect(execute(BYTES).output).toBe(BYTES_OUTPUT);
    const run = start(BYTES);
    for (let i = 0; i < 20; i += 1) {
      run.step();
    }
    PlivetCPP14Engine.libraryFunctionNames();
    while (run.step()) {
      // Stepped to the end.
    }
    expect(run.output()).toBe(BYTES_OUTPUT);
  });

  it('belong to the engine that is executing', () => {
    // Two runs stepped in turn, which a page never does - each visualizer
    // has a worker of its own - but which a class-level hook must survive.
    const narrow = start(`#include <stdio.h>
#include <string.h>
typedef unsigned char unit;
int main(void) {
  unit cells[4];
  memset(cells, 1, sizeof cells);
  printf("%d %d\\n", cells[0], cells[3]);
  return 0;
}
`);
    const wide = start(`#include <stdio.h>
#include <string.h>
typedef int unit;
int main(void) {
  unit cells[4];
  memset(cells, 1, sizeof cells);
  printf("%d %d\\n", cells[0], cells[3]);
  return 0;
}
`);
    let going = true;
    while (going) {
      going = [narrow.step(), wide.step()].some((one) => one);
    }
    expect(narrow.output()).toBe('1 1\n');
    expect(wide.output()).toBe('16843009 16843009\n');
  });

  it('are the engine defaults when no program is running', () => {
    execute(BYTES);
    const { Engine } = jest.requireActual(
      'unicoen.ts/dist/interpreter/Engine/Engine'
    );
    expect(Engine.sizeof('byte')).toBe(4);
    expect(Engine.sizeof('uint8_t')).toBe(1);
  });
});
