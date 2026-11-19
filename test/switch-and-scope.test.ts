import { outputOf } from './library';

/**
 * Two rules of C's control and scope the engine had wrong.
 *
 * A label written straight after another (`case 'q': case 'Q':`) was read
 * as an empty statement and a stray constant inside the first label: a
 * match on the first stopped the program, and the second matched nothing.
 * And a called function looked a name up through its caller's scopes, so a
 * caller's local hid a global of the same name from it.
 */

describe('switch', () => {
  it('runs a statement under stacked labels for each of them', async () => {
    for (const [value, expected] of [
      [2, 'List\n'],
      [3, 'List\n'],
      [4, 'Done\n'],
    ] as const) {
      expect(
        await outputOf(`#include <stdio.h>
int main(void){int c=${value}; switch(c){case 2: case 3: puts("List"); break; default: puts("Done");} return 0;}`)
      ).toBe(expected);
    }
  });

  it('falls through, runs a block after a label, and stacks character labels', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  for (int c = 0; c < 6; c++) {
    switch (c) {
    case 0:
    case 1:
      printf("low ");
      break;
    case 2:
      printf("two ");
    case 3:
      printf("fall ");
      break;
    case 4: {
      int x = c * 10;
      printf("%d ", x);
      break;
    }
    default:
      printf("other ");
    }
  }
  printf("\\n");
  char cmds[] = "qQx";
  for (int i = 0; cmds[i] != '\\0'; i++) {
    switch (cmds[i]) {
    case 'q': case 'Q': printf("quit "); break;
    default: printf("? ");
    }
  }
  printf("\\n");
  return 0;
}`)
    ).toBe('low low two fall fall 40 other \nquit quit ? \n');
  });

  it('reaches a default written before the cases, and leaves a loop with continue', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) {
  for (int i = 0; i < 4; i++) {
    switch (i) {
    default:
      printf("d");
      break;
    case 1:
      continue;
    case 2:
      printf("two");
    }
    printf("%d ", i);
  }
  printf("\\n");
  return 0;
}`)
    ).toBe('d0 two2 d3 \n');
  });
});

describe("a called function's names", () => {
  it("are its own and the file's, never its caller's locals", async () => {
    expect(
      await outputOf(`#include <stdio.h>
int count = 7;
void show(void) { printf("%d\\n", count); }
int main(void) { int count = 1; show(); printf("%d\\n", count); return 0; }`)
    ).toBe('7\n1\n');
  });

  it('include its parameters, blocks, statics and extern declarations', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int count = 7;
int depth(int n) { int count = n; if (n == 0) return count; return depth(n - 1) + count; }
void show(void) { static int calls; calls++; printf("%d %d\\n", count, calls); }
void shadow(int count) { printf("%d\\n", count); { int count = 99; printf("%d\\n", count); } }
void bump(void) { extern int count; count++; }
int main(void) { int count = 1; show(); show(); shadow(5); bump(); show(); printf("%d %d\\n", count, depth(3)); return 0; }`)
    ).toBe('7 1\n7 2\n5\n99\n8 3\n1 6\n');
  });
});
