import { Response, Server } from '../src/core';
import { jscppSyntaxError } from '../src/interpreter/jscpp/JscppSyntax';
import { mask } from '../src/interpreter/scan';
import {
  REFUSED_CONSTRUCTS,
  RefusedConstructId,
  refusedConstruct,
} from '../src/interpreter/refused';
import { outputOf, valueOf } from './library';

/**
 * The refused-construct list (L9): what the interpreter will not run, the
 * message the editor gives, and the pattern a host checks course sources
 * with. The patterns and the interpreter have to agree - a construct the
 * interpreter refuses that the course's lint lets through is a visualized
 * block that will not start - so both are run over the same programs here.
 */

const refused: [string, RefusedConstructId, string][] = [
  [
    'a goto and its label',
    'label',
    'int main(void){\n  goto done;\ndone:\n  return 0;\n}',
  ],
  ['a label alone', 'label', 'int main(void){\ndone:\n  return 0;\n}'],
  [
    'a label after a statement',
    'label',
    'int main(void){ int i = 0; again: i++; return i; }',
  ],
  ['a goto alone', 'goto', 'int main(void){\n  goto done;\n  return 0;\n}'],
];

const accepted: [string, string][] = [
  [
    'a left shift assignment',
    'int main(void){ int y = 1; y <<= 3; return y; }',
  ],
  [
    'a right shift assignment',
    'int main(void){\n  int y = 14;\n  y >>= 1;\n  return y;\n}',
  ],
  [
    'the shifts themselves',
    'int main(void){ int y = 28; return (y >> 2) << 1; }',
  ],
  ['a comparison', 'int main(void){ int y = 1; return y >= 1; }'],
  ['a conditional', 'int main(void){ int a = 1 ? 2 : 3; return a; }'],
  [
    'a conditional broken before its colon',
    'int main(void){\n  int a = 1\n    ? 2\n    : 3;\n  return a;\n}',
  ],
  [
    'case and default labels',
    'int main(void){ int x = 1;\n switch (x) {\n case 1: break;\n default : break;\n }\n return 0; }',
  ],
  [
    'bit-fields, named and unnamed',
    'struct S { unsigned a : 3; unsigned : 2; int b:1; };\nint main(void){ struct S s; s.a = 1; return s.a; }',
  ],
  [
    'the words inside a string and a comment',
    'int main(void){ char *s = "goto x; y >>= 1; done:"; /* goto */ return s[0]; }',
  ],
];

const matches = (code: string): RefusedConstructId[] =>
  REFUSED_CONSTRUCTS.filter((construct) =>
    new RegExp(construct.pattern).test(mask(code))
  ).map((construct) => construct.id);

describe('the refused-construct list', () => {
  it('holds goto and labels, each once, with a message', () => {
    expect(REFUSED_CONSTRUCTS.map((construct) => construct.id)).toEqual([
      'goto',
      'label',
    ]);
    for (const construct of REFUSED_CONSTRUCTS) {
      expect(construct.construct.length).toBeGreaterThan(0);
      expect(construct.message.length).toBeGreaterThan(0);
      expect(refusedConstruct(construct.id)).toBe(construct);
    }
  });

  it('leaves both compound shifts out, because they run', () => {
    expect(REFUSED_CONSTRUCTS.map((construct) => construct.construct)).toEqual(
      expect.not.arrayContaining(['<<=', '>>='])
    );
    expect(
      matches('int main(void){ int y = 1; y <<= 3; y >>= 2; return y; }')
    ).toEqual([]);
  });

  it('writes patterns JavaScript and Python read alike', () => {
    for (const { pattern } of REFUSED_CONSTRUCTS) {
      expect(() => new RegExp(pattern)).not.toThrow();
      // No lookbehind, no named group or backreference, no inline flag, no
      // Unicode property or code point escape: each is either missing from
      // one of the two engines or spelled differently in it.
      expect(pattern).not.toMatch(/\(\?<|\(\?P|\\k<|\(\?[a-zA-Z]|\\[pPu]\{|\$/);
    }
  });
});

describe('the patterns and the interpreter', () => {
  it.each(refused)(
    'refuse %s alike, with the message from the list',
    (_name, id, code) => {
      expect(matches(code)).toContain(id);
      const found = jscppSyntaxError(code);
      expect(found).not.toBeNull();
      expect(found!.message).toBe(refusedConstruct(id).message);
    }
  );

  it.each(accepted)('accept %s alike', (_name, code) => {
    expect(matches(code)).toEqual([]);
    expect(jscppSyntaxError(code)).toBeNull();
  });
});

const shifted = (body: string): Promise<string> =>
  outputOf(
    `#include <stdio.h>\nstruct S { int a; };\nint main(void) {\n${body}\nreturn 0;\n}`
  );

describe('<<=, which is not refused', () => {
  it.each([
    ['on an int', 'int x = 1; x <<= 3; printf("%d\\n", x);', '8\n'],
    ['by an expression', 'int x = 3; x <<= 1 + 1; printf("%d\\n", x);', '12\n'],
    [
      'in a for loop',
      'int n = 0; for (int i = 1; i < 100; i <<= 1) { n++; } printf("%d\\n", n);',
      '7\n',
    ],
    [
      'as a value',
      'int x = 3; int z = (x <<= 2); printf("%d %d\\n", x, z);',
      '12 12\n',
    ],
    [
      'wrapping an unsigned char',
      'unsigned char c = 200; c <<= 1; printf("%d\\n", c);',
      '144\n',
    ],
    [
      'wrapping an unsigned int',
      'unsigned int u = 0x80000001u; u <<= 1; printf("%u\\n", u);',
      '2\n',
    ],
    [
      'through a pointer and on members',
      'int x = 5; int *p = &x; *p <<= 2; struct S s; s.a = 3; s.a <<= 3; struct S *q = &s; q->a <<= 1; printf("%d %d\\n", x, s.a);',
      '20 48\n',
    ],
  ])('shifts %s', async (_name, body, expected) => {
    expect(await shifted(body)).toBe(expected);
  });
});

/**
 * `>>=`, which was refused until `ShiftAssignLexer` handed the grammar the
 * tokens it wants. Before that the statement was dropped from the tree, so
 * every case here printed the value from before the shift.
 */
describe('>>=, which is not refused', () => {
  it.each([
    ['on an int', 'int x = 64; x >>= 3; printf("%d\\n", x);', '8\n'],
    ['written without spaces', 'int x = 64; x>>=3; printf("%d\\n", x);', '8\n'],
    [
      'by an expression',
      'int x = 96; x >>= 1 + 1; printf("%d\\n", x);',
      '24\n',
    ],
    [
      'in a for loop',
      'int n = 0; for (int i = 64; i > 0; i >>= 1) { n++; } printf("%d\\n", n);',
      '7\n',
    ],
    [
      'as a value',
      'int x = 48; int z = (x >>= 2); printf("%d %d\\n", x, z);',
      '12 12\n',
    ],
    [
      'beside the comparisons it was lexed as',
      'int x = 64; x >>= 1; int ok = x >= 32 && x > 31; printf("%d %d\\n", x, ok);',
      '32 1\n',
    ],
    [
      // Implementation-defined in C; GCC on x86-64 shifts arithmetically.
      'a negative int, keeping its sign',
      'int x = -16; x >>= 2; printf("%d\\n", x);',
      '-4\n',
    ],
    [
      'an unsigned int, bringing in zeros',
      'unsigned int u = 0xF0000000u; u >>= 4; printf("%u\\n", u);',
      '251658240\n',
    ],
    [
      'an unsigned char',
      'unsigned char c = 200; c >>= 1; printf("%d\\n", c);',
      '100\n',
    ],
    [
      'through a pointer and on members',
      'int x = 80; int *p = &x; *p >>= 2; struct S s; s.a = 96; s.a >>= 3; struct S *q = &s; q->a >>= 1; printf("%d %d\\n", x, s.a);',
      '20 6\n',
    ],
  ])('shifts %s', async (_name, body, expected) => {
    expect(await shifted(body)).toBe(expected);
  });

  it('is a step of its own, and the canvas shows its result', async () => {
    const server = new Server();
    const send = (controlEvent: 'Start' | 'Step'): Promise<Response> =>
      server.send({
        controlEvent,
        sourcecode:
          'int main(void) {\n  int x = 64;\n  x >>= 3;\n  return x;\n}',
      });
    const log = console.log;
    console.log = () => undefined;
    const steps: [number | undefined, string][] = [];
    try {
      let response = await send('Start');
      expect(response.errors).toEqual([]);
      for (
        let i = 0;
        i < 10 &&
        (response.debugState === 'First' ||
          response.debugState === 'Debugging');
        i += 1
      ) {
        response = await send('Step');
        let x = '-';
        try {
          x = valueOf(response.model, 'x');
        } catch {
          // Not declared yet, or out of scope again.
        }
        steps.push([response.location?.range.begin.y, x]);
      }
    } finally {
      console.log = log;
    }
    const shift = steps.findIndex(([line]) => line === 3);
    expect(shift).toBeGreaterThanOrEqual(0);
    expect(steps[shift][1]).toBe('64');
    expect(steps[shift + 1][1]).toBe('8');
  });
});
