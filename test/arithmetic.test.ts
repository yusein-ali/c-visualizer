import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import {
  ExpressionModel,
  ExpressionNodeModel,
  extractModel,
} from '../src/core';
import { evaluate, valueAs } from '../src/interpreter/Arithmetic';
import { exec, outputOf, rulesOf, valueOf } from './library';

/*
 * Binary operators with C's integer promotions and usual arithmetic
 * conversions (C11 6.3.1) at the engine's ILP32 widths. The engine computed
 * in plain JavaScript numbers: `-1 < 0u` was 1 and `0u - 1` was -1.
 */

describe('the arithmetic rules', () => {
  it('converts a signed operand to unsigned before comparing', () => {
    expect(evaluate('<', -1, 'int', 0, 'unsigned int')?.value).toBe(false);
    expect(evaluate('>', -1, 'int', 1, 'unsigned int')?.value).toBe(true);
    expect(evaluate('<', -1, 'int', 0, 'long')?.value).toBe(true);
  });

  it('wraps unsigned arithmetic modulo 2^32', () => {
    expect(evaluate('-', 0, 'unsigned int', 1, 'int')).toMatchObject({
      value: 4294967295,
      type: 'unsigned int',
      overflow: false,
    });
    expect(evaluate('*', 65536, 'unsigned int', 65536, 'int')?.value).toBe(0);
  });

  it('promotes unsigned char and short to int', () => {
    expect(
      evaluate('+', 200, 'unsigned char', 200, 'unsigned char')
    ).toMatchObject({ value: 400, type: 'int' });
    expect(evaluate('-', 0, 'unsigned short', 1, 'int')?.value).toBe(-1);
  });

  it('flags signed overflow and wraps it to 32 bits', () => {
    expect(evaluate('+', 2147483647, 'int', 1, 'int')).toMatchObject({
      value: -2147483648,
      overflow: true,
    });
    expect(evaluate('/', -2147483648, 'int', -1, 'int')?.overflow).toBe(true);
    expect(evaluate('+', 2147483647, 'long long', 1, 'int')).toMatchObject({
      value: 2147483648,
      overflow: false,
    });
  });

  it('divides integers toward zero and keeps the remainder sign', () => {
    expect(evaluate('/', -7, 'int', 2, 'int')?.value).toBe(-3);
    expect(evaluate('%', -7, 'int', 2, 'int')?.value).toBe(-1);
    expect(evaluate('/', 7, 'int', 2.0, 'double')?.value).toBe(3.5);
    expect(evaluate('/', 1, 'int', 0, 'int')?.divisionByZero).toBe(true);
  });

  it('shifts an unsigned value logically and a signed one arithmetically', () => {
    expect(evaluate('>>', 0x80000000, 'unsigned int', 31, 'int')?.value).toBe(
      1
    );
    expect(evaluate('>>', -8, 'int', 1, 'int')?.value).toBe(-4);
    expect(evaluate('<<', 1, 'int', 32, 'int')?.badShift).toBe(true);
  });

  it('meets an unsigned int and a long in unsigned long, as ILP32 does', () => {
    expect(evaluate('+', 1, 'unsigned int', -2, 'long')).toMatchObject({
      type: 'unsigned long',
      value: 4294967295,
    });
  });

  it('reads a stored value as its own type holds it', () => {
    expect(valueAs(-1, 'unsigned int')).toBe(4294967295);
    expect(valueAs(300, 'unsigned char')).toBe(44);
    expect(valueAs(7, '_Bool')).toBe(1);
  });
});

describe('a running program', () => {
  it('prints what C computes', async () => {
    const output = await outputOf(`#include <stdio.h>
#include <string.h>
int main(void) {
  int below = -1 < 0u;
  unsigned int u = 0u - 1;
  unsigned char uc = 255;
  uc = uc + 1;
  short s = 32767;
  s = s + 1;
  unsigned big = 3000000000u;
  double d = big + 0.5;
  long long ll = 3000000000LL;
  char empty[1] = "";
  printf("%d %u %d %d %.1f %lld\\n", below, u, uc, s, d, ll + 1);
  printf("%d %d %u\\n", -7 / 2, -7 % 2, 0x80000000u >> 31);
  printf("%d %f\\n", strlen(empty) - 1 > 0, (double)5 / 2);
  return 0;
}
`);
    expect(output).toBe(
      '0 4294967295 0 -32768 3000000000.5 3000000001\n-3 -1 1\n1 2.500000\n'
    );
  });

  it('stores values at the width of the object, which the canvas shows', async () => {
    const run = await exec(`int main(void) {
  unsigned int u = -1;
  unsigned char c = 300;
  unsigned char d = 255;
  d = d + 1;
  long long wide = 3000000000LL;
  _Bool b = 7;
  return 0;
}
`);
    expect(valueOf(run.model, 'u')).toBe('4294967295');
    expect(valueOf(run.model, 'c')).toBe('44');
    expect(valueOf(run.model, 'd')).toBe('0');
    expect(valueOf(run.model, 'wide')).toBe('3000000000');
    expect(valueOf(run.model, 'b')).toBe('1');
  });

  it('records signed overflow once per line, and goes on', async () => {
    const run = await exec(`#include <stdio.h>
#include <limits.h>
int main(void) {
  int total = INT_MAX;
  for (int i = 0; i < 3; i++) {
    total = total + 1;
  }
  printf("%d\\n", total);
  return 0;
}
`);
    expect(run.output).toBe('-2147483646\n');
    expect(rulesOf(run)).toEqual(['signed-overflow']);
    expect(run.runtime[0]).toMatchObject({
      line: 6,
      severity: 'warning',
      fatal: false,
    });
    expect(run.runtime[0].message).toContain('undefined behavior');
  });

  it('assigns through a compound operator to an element or a member', async () => {
    expect(
      await outputOf(`#include <stdio.h>
struct P { unsigned char x; };
int main(void) {
  int a[3] = {1, 2, 3};
  struct P pt;
  pt.x = 250;
  a[1] += 5;
  pt.x += 10;
  printf("%d %d\\n", a[1], pt.x);
  return 0;
}
`)
    ).toBe('7 4\n');
  });
});

/** Every tree drawn while a program runs, as the canvas would get them. */
const trees = (code: string): ExpressionModel[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const found: ExpressionModel[] = [];
  try {
    const record = (state: Parameters<typeof extractModel>[0]) => {
      const expression = extractModel(state).expression;
      if (expression !== null) {
        found.push(expression);
      }
    };
    record(interpreter.startStepExecution(code));
    for (let steps = 0; interpreter.isStepExecutionRunning() && steps < 500; ) {
      record(interpreter.stepExecute());
      steps += 1;
    }
    return found;
  } finally {
    console.log = log;
  }
};

const nodes = (root: ExpressionNodeModel): ExpressionNodeModel[] => [
  root,
  ...root.children.flatMap(nodes),
];

describe('the drawn conversion and the computed value', () => {
  it('agree for a signed operand compared with an unsigned one', async () => {
    const code = `int main(void) {
  int n = -1;
  int below = n < 0u;
  return 0;
}
`;
    // The tree drawn before line 3 runs says `n` becomes 4294967295...
    const drawn = trees(code).filter((tree) => tree.range.begin.y === 3);
    const conversion = nodes(drawn[drawn.length - 1].root).find(
      (node) => node.kind === 'conversion' && node.text === 'int → unsigned int'
    );
    expect(conversion?.value).toBe('4294967295');
    // ...and the comparison the engine then makes is with that value.
    expect(valueOf((await exec(code)).model, 'below')).toBe('0');
  });
});
