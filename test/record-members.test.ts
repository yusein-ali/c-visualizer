import { CellModel, StepModel } from '../src/core';
import { exec, outputOf, rulesOf, typeOf, valueOf } from './library';

/*
 * Two kinds of structure member the engine laid out as a single entry:
 *
 *   - an array (`char name[8]`), which is now one entry per element, drawn
 *     as an array, and read and written by subscripts and the string
 *     functions;
 *   - a bit-field (L17), which keeps its width: a store wraps at it, the row
 *     says `a : 3`, and `sizeof` packs consecutive fields as gcc does.
 */

/** The rows that draw one structure's members, by the name cell's text. */
const memberRows = (model: StepModel, record: string): string[] => {
  const rows = model.stacks.flatMap((stack) => stack.rows);
  const start = rows.findIndex((cells) =>
    cells.some((cell) => cell.kind === 'name' && cell.text === record)
  );
  const names: string[] = [];
  for (const cells of rows.slice(start + 1)) {
    if (cells[0].kind !== 'indent') {
      break;
    }
    const name = cells.find((cell: CellModel) => cell.kind === 'name');
    if (typeof name !== 'undefined') {
      names.push(name.text);
    }
  }
  return names;
};

describe('an array member', () => {
  it('is read and written by subscripts, strcpy and printf', async () => {
    const output = await outputOf(`#include <stdio.h>
#include <string.h>
struct S { char name[8]; int n; };
int main(void) {
  struct S s;
  strcpy(s.name, "bob");
  s.n = 3;
  s.name[0] = 'B';
  printf("%s %d %c %d %d\\n", s.name, s.n, s.name[1], (int)sizeof(s.name),
         (int)strlen(s.name));
  return 0;
}
`);
    expect(output).toBe('Bob 3 o 8 3\n');
  });

  it('is drawn as an array of its elements', async () => {
    const run = await exec(`#include <string.h>
struct S { char name[4]; int n; };
int main(void) {
  struct S s;
  strcpy(s.name, "ab");
  s.n = 1;
  return 0;
}
`);
    expect(memberRows(run.model, 's')).toEqual([
      'name',
      'name[0]',
      'name[1]',
      'name[2]',
      'name[3]',
      'n',
    ]);
    expect(typeOf(run.model, 'name')).toBe('char[4]');
    expect(valueOf(run.model, 'name[0]')).toBe("97 'a'");
    expect(valueOf(run.model, 'name[2]')).toBe("0 '\u0000'");
    expect(valueOf(run.model, 'name[3]')).toBe('uninitialized');
    expect(valueOf(run.model, 'n')).toBe('1');
  });

  it('is initialized from a list and copied with the structure', async () => {
    const output = await outputOf(`#include <stdio.h>
struct S { char name[8]; int n; };
int main(void) {
  struct S t = {"amy", 7};
  struct S u = t;
  u.name[1] = 'n';
  t = u;
  printf("%s %s %d %d\\n", t.name, u.name, u.n, t.name[5]);
  return 0;
}
`);
    expect(output).toBe('any any 7 0\n');
  });

  it('works in a two-dimensional member and in a block from malloc', async () => {
    const output = await outputOf(`#include <stdio.h>
#include <stdlib.h>
#include <string.h>
struct G { int cells[2][3]; char tag; };
typedef struct Item { char label[6]; int qty; struct Item *next; } Item;
int main(void) {
  struct G g = {{{1, 2, 3}, {4, 5, 6}}, 'x'};
  g.cells[1][2] = 60;
  Item *it = malloc(sizeof(Item));
  strcpy(it->label, "pen");
  it->qty = 2;
  it->next = NULL;
  Item *head = it;
  printf("%d %d %c %s %d %c\\n", g.cells[0][1], g.cells[1][2], g.tag,
         head->label, head->qty, it->label[2]);
  free(it);
  return 0;
}
`);
    expect(output).toBe('2 60 x pen 2 n\n');
  });

  it('refuses a subscript outside the member', async () => {
    const run = await exec(`struct S { int v[3]; };
int main(void) {
  struct S s;
  s.v[3] = 1;
  return 0;
}
`);
    expect(rulesOf(run)).toContain('array-out-of-bounds');
    expect(run.output).toContain('s.v');
  });
});

describe('a bit-field', () => {
  const code = `#include <stdio.h>
struct F { unsigned a : 3; unsigned b : 5; int s : 4; };
int main(void) {
  struct F f;
  f.a = 9;
  f.b = 3;
  f.s = 9;
  printf("%u %u %d %d\\n", f.a, f.b, f.s, (int)sizeof(struct F));
  f.a += 7;
  int d = f.a - 5;
  printf("%u %d\\n", f.a, d);
  return 0;
}
`;

  it('wraps what is stored in it at its width, unsigned and signed', async () => {
    // 9 is 1001: three bits keep 001, four signed bits read -7. Three
    // fields of 3, 5 and 4 bits share one four-byte unit, as gcc packs them.
    // `f.a - 5` is computed in int, to which a narrow bit-field promotes.
    expect(await outputOf(code)).toBe('1 3 -7 4\n0 -5\n');
  });

  it('is drawn with its width beside its name', async () => {
    const run = await exec(code);
    expect(memberRows(run.model, 'f')).toEqual(['a : 3', 'b : 5', 's : 4']);
    expect(valueOf(run.model, 'a : 3')).toBe('0');
    expect(valueOf(run.model, 's : 4')).toBe('-7');
    expect(typeOf(run.model, 'a : 3')).toBe('unsigned');
  });
});
