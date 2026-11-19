import { exec, outputOf } from './library';

/**
 * What a file-scope declaration may name, and the names C keeps apart.
 *
 * The engine filed every file-scope declaration where it is written and loaded
 * the library after them, so an initializer could name neither a function
 * defined further down (or in another file, declared in a header) nor `NULL`:
 * the run failed at Start with "variable twice is not defined". An `extern`
 * declaration of an array of unknown size failed with "Invalid array length",
 * a `static` array of function pointers lost the rest of the file to the
 * parser ("No entry point"), and a function named like a structure tag was
 * hidden by the tag.
 */

describe('a file-scope initializer', () => {
  it('names a function declared by a prototype and defined below it', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int twice(int value);
struct row { const char *name; int (*run)(int value); };
const struct row rows[] = { {"twice", twice}, {"none", NULL} };
int twice(int value) { return 2 * value; }
int main(void) {
  printf("%s %d %d\\n", rows[0].name, rows[0].run(21), rows[1].run == NULL);
  return 0;
}`)
    ).toBe('twice 42 1\n');
  });

  it('names NULL and the library macros', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <limits.h>
const char *names[] = {"one", NULL};
int *pointer = NULL;
int best = INT_MAX;
int end = EOF;
int main(void) {
  printf("%s %d %d %d %d\\n", names[0], names[1] == NULL, pointer == NULL, best, end);
  return 0;
}`)
    ).toBe('one 1 1 2147483647 -1\n');
  });
});

describe('extern of an array of unknown size', () => {
  it('declares the object its definition defines', async () => {
    expect(
      await outputOf(`#include <stdio.h>
extern const int numbers[];
const int numbers[] = {1, 2, 3, 0};
int main(void) {
  printf("%d %d\\n", numbers[1], (int)(sizeof numbers / sizeof numbers[0]));
  return 0;
}`)
    ).toBe('2 4\n');
  });

  it('declares a table of structures defined with a length', async () => {
    expect(
      await outputOf(`#include <stdio.h>
struct move_name { const char *name; int (*fn)(int); };
extern const struct move_name move_names[];
extern int counts[];
int twice(int n) { return 2 * n; }
int thrice(int n) { return 3 * n; }
const struct move_name move_names[] = { {"twice", twice}, {"thrice", thrice}, {NULL, NULL} };
int counts[3] = {1, 2, 3};
int main(void) {
  for (int i = 0; move_names[i].name != NULL; i++) {
    printf("%s %d\\n", move_names[i].name, move_names[i].fn(5));
  }
  counts[2] = 9;
  printf("%d\\n", counts[2]);
  return 0;
}`)
    ).toBe('twice 10\nthrice 15\n9\n');
  });
});

describe('an array of function pointers', () => {
  it('may be static, and its pointers const', async () => {
    expect(
      await outputOf(`#include <stdio.h>
static int one(const void *a, const void *b) { (void)a; (void)b; return 1; }
static int two(const void *a, const void *b) { (void)a; (void)b; return 2; }
static int (*compares[])(const void *a, const void *b) = { one, two };
static int (*const fixed[2])(const void *, const void *) = { two, one };
int main(void) {
  static int (*local)(const void *, const void *) = one;
  printf("%d %d %d\\n", compares[1](NULL, NULL), fixed[1](NULL, NULL), local(NULL, NULL));
  return 0;
}`)
    ).toBe('2 1 1\n');
  });

  it("keeps a const return type off the pointer's own", async () => {
    expect(
      await outputOf(`#include <stdio.h>
static const char *(*namer)(int);
const char *name_of(int n) { return n ? "yes" : "no"; }
int main(void) {
  namer = name_of;
  printf("%s\\n", namer(1));
  return 0;
}`)
    ).toBe('yes\n');
  });
});

describe('a structure tag', () => {
  it('leaves a function of the same name callable', async () => {
    expect(
      await outputOf(`#include <stdio.h>
typedef struct creature Creature;
struct creature { int hp; };
void move_towards(Creature *monster) { (void)monster; }
struct move_name { const char *name; void (*move)(Creature *monster); };
const struct move_name move_names[] = { {"towards", move_towards}, {NULL, NULL} };
const char *move_name(void (*move)(Creature *monster)) {
  for (int i = 0; move_names[i].name != NULL; i++) {
    if (move_names[i].move == move) {
      return move_names[i].name;
    }
  }
  return "none";
}
int main(void) {
  printf("%s\\n", move_name(move_towards));
  return 0;
}`)
    ).toBe('towards\n');
  });

  it('is measured by sizeof, and declares, beside a function and an object of its name', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdlib.h>
struct book { int pages; struct book *next; };
int book(int n) { return n * 2; }
typedef struct node node;
struct node { int v; node *next; };
enum color { RED, GREEN };
int color(enum color c) { return c + 10; }
int main(void) {
  struct book local = {3, NULL};
  struct book *heap = malloc(sizeof(struct book));
  heap->pages = 5;
  node n = {1, NULL};
  printf("%d %d %zu %d %d\\n", book(local.pages), heap->pages, sizeof(struct book), n.v, color(GREEN));
  free(heap);
  return 0;
}`);
    expect(run.output).toBe('6 5 8 1 11\n');
    expect(run.runtime).toEqual([]);
  });
});
