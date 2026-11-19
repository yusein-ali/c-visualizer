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

/**
 * A member read through a pointer to a freed structure. It stopped with
 * "could not be executed" at the top level; in a called function the
 * engine's call runner swallowed the stop and the caller ran on with 0 - so
 * the wrong `free(head); head = head->next;` loop finished "freeing" its
 * list. A declaration taking the freed block (`Book *current = *shelf;`)
 * also brought it back onto the canvas as a block nothing had written.
 */
describe('a member of a freed structure', () => {
  const node = 'struct node { int value; struct node *next; };';

  it('is refused naming the freed block, at the top level', async () => {
    const run = await exec(
      program(
        `  struct node *p = malloc(sizeof(struct node));
  p->value = 7;
  free(p);
  int v = p->value;
  printf("after the read: %d\\n", v);`,
        node
      )
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
    expect(run.runtime[0].message).toBe(
      'the block p points to has been freed, so p->value does not ' +
        'designate an object'
    );
    expect(run.output).not.toMatch(/after the read/);
  });

  it('is refused in a called function, and the caller does not go on', async () => {
    const run = await exec(
      program(
        `  struct node *p = malloc(sizeof(struct node));
  p->value = 7;
  p->next = NULL;
  printf("read %d\\n", read_after_free(p));
  printf("main goes on\\n");`,
        `${node}
int read_after_free(struct node *p)
{
  free(p);
  return p->value;
}`
      )
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
    expect(run.runtime[0].line).toBe(7);
    expect(run.output).not.toMatch(/read|main goes on/);
  });

  it("stops page 8.2's wrong loop at its first read of a freed node", async () => {
    const run = await exec(
      program(
        `  struct node *head = NULL;
  for (int i = 0; i < 3; i++) {
    struct node *n = malloc(sizeof(struct node));
    n->value = i;
    n->next = head;
    head = n;
  }
  free_list(head);
  printf("The list is freed\\n");`,
        `${node}
void free_list(struct node *head)
{
  while (head != NULL) {
    free(head);
    head = head->next;
  }
}`
      )
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
    expect(run.runtime[0].message).toBe(
      'the block head points to has been freed, so head->next does not ' +
        'designate an object'
    );
    expect(run.output).not.toMatch(/The list is freed/);
  });

  it('leaves the freed block off the canvas', async () => {
    const run = await exec(
      program(
        `  Book *dune = malloc(sizeof(Book));
  Book *shelf;
  dune->title = "Dune";
  dune->next = NULL;
  shelf = dune;
  free(dune);
  printf("%d\\n", on_shelf(&shelf, "Emma"));`,
        `#include <string.h>
typedef struct book {
  char *title;
  struct book *next;
} Book;
int on_shelf(Book **shelf, const char *title)
{
  Book *current = *shelf;
  while (current != NULL && strcmp(current->title, title) != 0) {
    current = current->next;
  }
  return current != NULL;
}`
      )
    );
    expect(rulesOf(run)).toEqual(['use-after-free']);
    const names = run.model.stacks.flatMap((stack) =>
      stack.rows.map(
        (row) => row.find((cell) => cell.kind === 'name')?.text ?? ''
      )
    );
    expect(names).toContain('current');
    expect(names.filter((name) => name.startsWith('Heap:'))).toEqual([]);
  });
});
