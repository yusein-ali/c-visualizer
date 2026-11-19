import { exec, rulesOf } from './library';

/**
 * Stores and reads gcc's program crashes on, or reads past an object: they
 * stop the run with a message that says what went wrong, rather than running
 * on (a store through a null pointer, into a string literal) or ending with
 * "could not be executed" (an index past the end of a heap block).
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

describe('a store through a null pointer', () => {
  it('stops the run before the next statement', async () => {
    const run = await exec(
      program(`  int *p = NULL;
  *p = 3;
  printf("after\\n");`)
    );
    expect(run.output).not.toMatch(/after/);
    expect(run.output).toMatch(/stopped the program on line 6: .*null pointer/);
    expect(rulesOf(run)).toEqual(['null-dereference']);
  });

  it('stops an increment and a compound assignment too', async () => {
    for (const store of ['(*p)++;', '*p += 2;']) {
      const run = await exec(
        program(`  int *p = NULL;
  ${store}
  printf("after\\n");`)
      );
      expect(run.output).not.toMatch(/after/);
      expect(rulesOf(run)).toEqual(['null-dereference']);
    }
  });
});

describe('a store into a string literal', () => {
  it('stops the run, through a subscript or a dereference', async () => {
    for (const store of ["s[0] = 'd';", "*(s + 1) = 'U';"]) {
      const run = await exec(
        program(`  char *s = "Dune";
  ${store}
  printf("%s\\n", s);`)
      );
      expect(run.output).toMatch(/string literal/);
      expect(run.output).not.toMatch(/dune|DUne/);
      expect(rulesOf(run)).toEqual(['string-literal-modification']);
    }
  });

  it('leaves a char array initialized from a literal writable', async () => {
    const run = await exec(
      program(`  char s[] = "Dune";
  s[0] = 'd';
  char *t = s;
  t[1] = 'U';
  printf("%s\\n", s);`)
    );
    expect(run.output).toBe('dUne\n');
    expect(run.runtime).toEqual([]);
  });
});

describe('an index past the end of a heap block', () => {
  it('names the bound, as for an array', async () => {
    const run = await exec(
      program(`  int *p = malloc(3 * sizeof(int));
  p[3] = 4;
  free(p);`)
    );
    expect(rulesOf(run)).toEqual(['array-out-of-bounds']);
    expect(run.output).toMatch(
      /index 3 is outside the block p points to; valid indices are 0 through 2/
    );
  });

  it('names the bound for a read and for a block of records', async () => {
    const read = await exec(
      program(`  double *d = malloc(2 * sizeof(double));
  d[0] = 1.5;
  printf("%f\\n", d[2]);`)
    );
    expect(rulesOf(read)).toEqual(['array-out-of-bounds']);
    expect(read.output).toMatch(/valid indices are 0 through 1/);
    const records = await exec(
      program(
        `  struct P *ps = malloc(2 * sizeof(struct P));
  ps[2].x = 1;`,
        'struct P { int x; int y; };'
      )
    );
    expect(rulesOf(records)).toEqual(['array-out-of-bounds']);
    expect(records.output).toMatch(/valid indices are 0 through 1/);
  });

  it('counts from where the pointer points into the block', async () => {
    const run = await exec(
      program(`  int *p = malloc(4 * sizeof(int));
  int *q = p + 1;
  q[2] = 5;
  q[3] = 6;`)
    );
    expect(rulesOf(run)).toEqual(['array-out-of-bounds']);
    expect(run.output).toMatch(
      /index 3 is outside the block q points to; valid indices are -1 through 2/
    );
  });

  it('says a freed block is gone', async () => {
    const run = await exec(
      program(`  int *p = malloc(3 * sizeof(int));
  free(p);
  p[0] = 1;`)
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
  });
});
