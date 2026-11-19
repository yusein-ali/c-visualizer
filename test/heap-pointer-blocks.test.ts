import { exec, outputOf } from './library';

/**
 * A heap block of pointers to structures.
 *
 * The stock `malloc` carves a block by the type it was last told of, and two
 * paths told it the pointee's pointee: `p = malloc(n * sizeof *p)` took every
 * `*` off `p`'s type, and a declaration `Book **order = malloc(...)` named its
 * type before its `*`s were on it. Both blocks were carved as `Book` records,
 * so `qsort` over the pointers was refused for an element size of 4, and the
 * block was drawn with a row more than the pointers it holds.
 */

describe('a heap array of pointers to structures', () => {
  it('is sorted by qsort with sizeof *books', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
typedef struct book {
  const char *title;
  int year;
  struct book *next;
} Book;
int by_year(const void *a, const void *b) {
  const Book *first = *(const Book *const *)a;
  const Book *second = *(const Book *const *)b;
  return first->year - second->year;
}
void list_books(const Book *shelf, int count) {
  const Book **books;
  int i = 0;
  books = malloc(count * sizeof *books);
  for (const Book *book = shelf; book != NULL; book = book->next) {
    books[i++] = book;
  }
  qsort(books, count, sizeof *books, by_year);
  for (i = 0; i < count; i++) {
    printf("%s %d\\n", books[i]->title, books[i]->year);
  }
  free(books);
}
int main(void) {
  Book kalevala = {"Kalevala", 1835, NULL};
  Book dune = {"Dune", 1965, &kalevala};
  Book hobbit = {"The Hobbit", 1937, &dune};
  list_books(&hobbit, 3);
  return 0;
}`)
    ).toBe('Kalevala 1835\nThe Hobbit 1937\nDune 1965\n');
  });

  it('is drawn with one row per pointer', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdlib.h>
typedef struct book { char *title; int year; } Book;
int main(void) {
  Book a = {"Dune", 1965};
  Book b = {"Emma", 1815};
  size_t count = 2;
  Book **order = malloc(count * sizeof order[0]);
  order[0] = &a;
  order[1] = &b;
  printf("%d\\n", (int)(count * sizeof order[0]));
  return 0;
}`);
    expect(run.output).toBe('8\n');
    const heap = run.model.memory.find((segment) => segment.key === 'heap')!;
    expect(
      heap.rows.map(
        (row) => row.find((cell) => cell.kind === 'value')?.text ?? ''
      )
    ).toHaveLength(2);
  });

  it('keeps pointers to scalars and to pointers one cell each', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdlib.h>
typedef struct { int x; } P;
int main(void) {
  int **rows;
  rows = malloc(2 * sizeof *rows);
  rows[0] = malloc(3 * sizeof *rows[0]);
  rows[1] = malloc(3 * sizeof **rows);
  rows[0][2] = 5;
  rows[1][1] = 6;
  P *ps;
  ps = malloc(2 * sizeof *ps);
  ps[1].x = 9;
  char **names;
  names = malloc(2 * sizeof *names);
  names[0] = "a";
  names[1] = "bc";
  printf("%d %d %d %s %zu %zu\\n", rows[0][2], rows[1][1], ps[1].x, names[1], sizeof *rows, sizeof *ps);
  free(rows[0]);
  free(rows[1]);
  free(rows);
  free(ps);
  free(names);
  return 0;
}`)
    ).toBe('5 6 9 bc 4 4\n');
  });
});
