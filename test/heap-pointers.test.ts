import { exec, outputOf, rulesOf } from './library';

/**
 * Heap blocks reached through the forms that Module 6 of the course teaches:
 * `sizeof *p` in p's own initializer, a pointer assigned apart from its
 * declaration or stored in an array of pointers, a function that returns a
 * pointer to a pointer, and a second or invalid `free`, which glibc stops.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

describe('sizeof in the initializer of the object it measures', () => {
  it('sizes the block of `int *a = malloc(3 * sizeof *a)`', async () => {
    expect(
      await outputOf(
        program(`  int *a = malloc(3 * sizeof *a);
  a[0] = 1;
  a[2] = 3;
  printf("%d %d\\n", a[0], a[2]);
  free(a);`)
      )
    ).toBe('1 3\n');
  });

  it('accepts the parenthesized form and a char block', async () => {
    expect(
      await outputOf(
        program(`  int *a = malloc(2 * sizeof(*a));
  char *s = malloc(4 * sizeof *s);
  a[1] = 7;
  strcpy(s, "abc");
  printf("%d %s %d\\n", a[1], s, (int)sizeof *a);
  free(a);
  free(s);`)
      )
    ).toBe('7 abc 4\n');
  });
});

describe('a char block reached through a pointer assigned apart from its declaration', () => {
  it('writes every byte through `p[i]` and `*(p + i)`', async () => {
    expect(
      await outputOf(
        program(`  char *p;
  p = malloc(4);
  p[0] = 'a';
  p[1] = 'b';
  *(p + 2) = 'c';
  p[3] = '\\0';
  printf("%s\\n", p);
  free(p);`)
      )
    ).toBe('abc\n');
  });

  it('copies a string into it with strcpy', async () => {
    expect(
      await outputOf(
        program(`  char *p;
  p = malloc(6);
  strcpy(p, "Dune!");
  printf("%s %d\\n", p, (int)strlen(p));
  free(p);`)
      )
    ).toBe('Dune! 5\n');
  });
});

describe('blocks stored in an array of pointers', () => {
  it('writes through an element of a local array of pointers', async () => {
    expect(
      await outputOf(
        program(`  char *w[2];
  w[0] = malloc(4);
  strcpy(w[0], "ab");
  w[1] = malloc(3);
  w[1][0] = 'c';
  w[1][1] = 'd';
  w[1][2] = '\\0';
  printf("%s %s\\n", w[0], w[1]);
  free(w[0]);
  free(w[1]);`)
      )
    ).toBe('ab cd\n');
  });

  it('writes through an element of an array of pointers on the heap', async () => {
    expect(
      await outputOf(
        program(`  char **w = malloc(2 * sizeof(char *));
  w[0] = malloc(4);
  strcpy(w[0], "ab");
  w[1] = malloc(2);
  w[1][0] = 'x';
  w[1][1] = '\\0';
  printf("%s|%c%c|%s\\n", w[0], w[0][0], w[0][1], w[1]);
  free(w[0]);
  free(w[1]);
  free(w);`)
      )
    ).toBe('ab|ab|x\n');
  });

  it('grows the array of titles and keeps every title', async () => {
    expect(
      await outputOf(
        program(`  int capacity = 1;
  int count = 0;
  char **titles = malloc(capacity * sizeof(char *));
  const char *names[3] = {"Dune", "Emma", "Kalevala"};
  for (int i = 0; i < 3; i++) {
    if (count == capacity) {
      capacity = capacity * 2;
      char **bigger = realloc(titles, capacity * sizeof(char *));
      titles = bigger;
    }
    titles[count] = malloc(strlen(names[i]) + 1);
    strcpy(titles[count], names[i]);
    count++;
  }
  for (int i = 0; i < count; i++) {
    printf("%s\\n", titles[i]);
    free(titles[i]);
  }
  free(titles);`)
      )
    ).toBe('Dune\nEmma\nKalevala\n');
  });
});

describe('a function that returns a pointer to a pointer', () => {
  it('runs, and its result can be used', async () => {
    expect(
      await outputOf(
        program(
          `  char **titles = make_titles(2);
  printf("%s %s\\n", titles[0], titles[1]);
  free(titles[0]);
  free(titles[1]);
  free(titles);
  printf("%d\\n", none() == NULL);`,
          `char **make_titles(int count)
{
  char **titles = malloc(count * sizeof(char *));
  for (int i = 0; i < count; i++) {
    char *title = malloc(3);
    title[0] = 'T';
    title[1] = (char)('0' + i);
    title[2] = '\\0';
    titles[i] = title;
  }
  return titles;
}

int **none(void)
{
  return NULL;
}`
        )
      )
    ).toBe('T0 T1\n1\n');
  });
});

describe('free of a block that is not live', () => {
  it('stops a second free of the same block, as glibc does', async () => {
    const run = await exec(
      program(`  char *title = malloc(20);
  free(title);
  free(title);
  printf("after\\n");`)
    );
    expect(run.output).not.toMatch(/^after$/m);
    expect(run.runtime.some((diagnostic) => diagnostic.fatal)).toBe(true);
    expect(rulesOf(run)).toContain('double-free');
  });

  it('stops a free of an address inside a block', async () => {
    const run = await exec(
      program(`  int *p = malloc(4 * sizeof(int));
  free(p + 1);
  printf("after\\n");`)
    );
    expect(run.output).not.toMatch(/^after$/m);
    expect(rulesOf(run)).toContain('invalid-free');
  });

  it('stops a free of an array on the stack', async () => {
    const run = await exec(
      program(`  int pages[3] = {1, 2, 3};
  free(pages);
  printf("after\\n");`)
    );
    expect(run.output).not.toMatch(/^after$/m);
    expect(rulesOf(run)).toContain('invalid-free');
  });

  it('stops a free of the block a realloc moved away', async () => {
    const run = await exec(
      program(`  int *a = malloc(2 * sizeof(int));
  int *b = malloc(sizeof(int));
  int *c = realloc(a, 8 * sizeof(int));
  free(a);
  printf("after\\n");
  free(b);
  free(c);`)
    );
    expect(run.output).not.toMatch(/^after$/m);
    expect(rulesOf(run)).toContain('double-free');
  });

  it('still accepts free(NULL) and a block freed once', async () => {
    expect(
      await outputOf(
        program(`  char *none = NULL;
  free(none);
  char *title = malloc(5);
  free(title);
  title = malloc(5);
  free(title);
  printf("ok\\n");`)
      )
    ).toBe('ok\n');
  });
});

describe('a pointer left behind by a realloc that moved the block', () => {
  it('is not given the old cells back when it is assigned', async () => {
    const run = await exec(
      program(`  int *a = malloc(2 * sizeof(int));
  int *b = malloc(sizeof(int));
  int *c = realloc(a, 8 * sizeof(int));
  int *stale;
  stale = a;
  stale[0] = 5;
  printf("after\\n");
  free(b);
  free(c);`)
    );
    expect(run.output).not.toMatch(/^after$/m);
    expect(run.runtime.some((diagnostic) => diagnostic.fatal)).toBe(true);
  });
});
