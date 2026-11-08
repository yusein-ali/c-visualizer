import { Response, Server, StepModel } from '../src/core';
import { exec, rowNamed, valueOf } from './library';

/*
 * The mutation view spells a pointer's value as the canvas does.
 *
 * The engine keeps objects at addresses of its own; the canvas lays the
 * stack and the string literals out again, so the address on a pointer's row
 * and the address of the object it points to are display addresses. The
 * mutation view used to print the engine's number, in decimal - `p: 50002 →
 * 50006` beside a row reading `0xC358` - so a reader could not match a write
 * to the object it made the pointer point at.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
${globals}
int main(void) {
${body}
  return 0;
}
`;

/** The address the canvas prints for an object, as text. */
const shownAddress = (model: StepModel, name: string): string =>
  /\((0x[0-9A-F]+)\)/.exec(
    rowNamed(model, name).find((cell) => cell.kind === 'address')!.text
  )![1];

const writesTo = (model: StepModel, target: string): string[][] =>
  model.mutations
    .filter((one) => one.target === target)
    .map(({ before, after }) => [before, after]);

/** Runs to a breakpoint on a 1-based line, as Continue does. */
const runTo = async (code: string, line: number): Promise<Response> => {
  const server = new Server();
  const logged = console.log;
  console.log = () => undefined;
  try {
    const stopped = new Promise<Response>((resolve) => {
      server.onRunEvent = (_event, response) => resolve(response);
    });
    await server.send({
      controlEvent: 'Exec',
      sourcecode: code,
      files: [{ path: 'main.c', text: code }],
      entry: 'main.c',
      breakpoints: [{ path: 'main.c', rows: [line - 1] }],
    });
    return await stopped;
  } finally {
    console.log = logged;
  }
};

describe('a write to a pointer', () => {
  it('names the objects by the addresses the canvas gives them', async () => {
    const { model } = await exec(
      program(`  char c = 'a';
  int x = 1;
  int y = 2;
  int *p = &x;
  p = &y;
  int *h = malloc(sizeof(int));
  p = h;
  char *s = "hi";
  s = "yo";`)
    );
    expect(writesTo(model, 'p')).toEqual([
      [shownAddress(model, 'x'), shownAddress(model, 'y')],
      [shownAddress(model, 'y'), '0x4E20'],
    ]);
    expect(valueOf(model, 'p')).toBe('0x4E20');
    // A string literal is drawn in the read-only band.
    const literal = writesTo(model, 's');
    expect(literal).toHaveLength(1);
    expect(literal[0][1]).toBe(valueOf(model, 's'));
    expect(literal[0][0]).toMatch(/^0x27[0-9A-F]{2}$/);
  });

  it('names an object in another frame by its address there', async () => {
    const { model } = await exec(
      program(
        `  int a = 1;
  int b = 2;
  int *p = &a;
  point(&p, &b);
  int *q = p;`,
        'void point(int **pp, int *to) { *pp = to; }'
      )
    );
    expect(writesTo(model, '*pp')).toEqual([
      [shownAddress(model, 'a'), shownAddress(model, 'b')],
    ]);
  });

  it('names the function a function pointer holds by its address', async () => {
    const { model } = await exec(
      program(
        `  int (*op)(int, int) = add;
  op = sub;
  int r = op(5, 3);`,
        'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }'
      )
    );
    const [[before, after]] = writesTo(model, 'op');
    expect(valueOf(model, 'op')).toBe(`sub (${after})`);
    expect(before).toMatch(/^0x1[0-9A-F]{3}$/);
  });

  it('says the same in the tooltip of the assignment', async () => {
    const code = program(`  int x = 1;
  int y = 2;
  int *p = &x;
  p = &y;
  x = 3;`);
    const { model } = await runTo(code, 9);
    const facts = model.constructStates.flatMap((one) => one.facts);
    expect(facts).toEqual(
      expect.arrayContaining([
        { label: 'factWas', value: shownAddress(model, 'x') },
        { label: 'factNow', value: shownAddress(model, 'y') },
      ])
    );
  });
});
