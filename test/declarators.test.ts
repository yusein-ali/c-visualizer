import { exec, outputOf, typeOf } from './library';

/**
 * A declaration of several declarators gives each the type its own `*`s
 * make. The stock declaration moved each declarator's `*`s onto the type
 * they all share, so in `struct node *a = &n, *b = &n;` the engine declared
 * `b` a `struct node **` (and the canvas said so), `int x, *p, **pp` made
 * `pp` an `int ***`, and a loop running the declaration again gave every
 * declarator the stars of them all.
 */
describe('a declaration of several declarators', () => {
  it('gives each the type its own stars make', async () => {
    const run = await exec(`#include <stdio.h>
struct node { int value; struct node *next; };
typedef struct node Node;
int main(void)
{
  struct node n = {7, NULL};
  struct node *a = &n, *b = &n;
  int x = 1, *p = &x, **pp = &p;
  Node *c = &n, *d = &n;
  int arr[3] = {4, 5, 6}, *q = arr, *const r = arr + 1;
  printf("%d %d %d %d %d %d %d %zu\\n", a->value, b->value, **pp, d->value,
         *(q + 2), *r, (int)(b + 1 - a), sizeof *pp);
  return 0;
}`);
    expect(run.output).toBe('7 7 1 7 6 5 1 4\n');
    expect(run.runtime).toEqual([]);
    expect(
      ['a', 'b', 'x', 'p', 'pp', 'c', 'd', 'arr', 'q', 'r'].map((name) =>
        typeOf(run.model, name)
      )
    ).toEqual([
      'struct node *',
      'struct node *',
      'int',
      'int *',
      'int * *',
      'Node (struct) *',
      'Node (struct) *',
      'int[3]',
      'int *',
      'int * const',
    ]);
  });

  it('gives them the same types every time it runs', async () => {
    expect(
      await outputOf(`#include <stdio.h>
struct S { int a; int b; int c; };
int main(void)
{
  int total = 0;
  for (int i = 0; i < 3; i++) {
    struct S s = {i, 0, 0}, *ps = &s, t = {1, 2, 3};
    int v = i, *p = &v, **pp = &p;
    total += (int)((char *)(ps + 1) - (char *)ps) + ps->a + t.c + **pp;
  }
  printf("%d\\n", total);
  return 0;
}`)
    ).toBe('51\n');
  });
});
