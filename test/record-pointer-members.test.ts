import { exec, outputOf, valueOf } from './library';

/**
 * A structure member that points to structures, as 7.4's growing shelf uses
 * one: `shelf->books = grown;` after `realloc`, a whole structure stored
 * through it, and a structure with a member of a typedef'd enumeration
 * declared without an initializer.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const SHELF = `typedef struct { int year; int pages; } Book;
typedef struct { Book *books; int count; } Shelf;`;

describe('a pointer member given a block another pointer holds', () => {
  it('is followed after a.data = grown', async () => {
    expect(
      await outputOf(
        program(
          `  struct array a;
  struct point *grown = malloc(2 * sizeof(struct point));
  a.data = grown;
  a.data[0].x = 7;
  a.data->y = 8;
  a.data[1].x = 9;
  printf("%d %d %d %d\\n", a.data[0].x, a.data[0].y, grown[1].x, (*a.data).y);
  free(grown);`,
          `struct point { int x; int y; };
struct array { struct point *data; int count; };`
        )
      )
    ).toBe('7 8 9 8\n');
  });

  it('is followed after realloc, assigned directly or through a variable', async () => {
    expect(
      await outputOf(
        program(
          `  Shelf shelf;
  shelf.books = malloc(2 * sizeof(Book));
  shelf.books[0].year = 1965;
  shelf.books = realloc(shelf.books, 4 * sizeof(Book));
  Book *grown = realloc(shelf.books, 8 * sizeof(Book));
  shelf.books = grown;
  shelf.books[1].year = 1937;
  shelf.books[7].pages = 3;
  printf("%d %d %d\\n", shelf.books[0].year, shelf.books[1].year, grown[7].pages);
  free(shelf.books);`,
          SHELF
        )
      )
    ).toBe('1965 1937 3\n');
  });

  it('grows a shelf through a pointer to it', async () => {
    expect(
      await outputOf(
        program(
          `  Shelf shelf = {NULL, 0};
  add(&shelf, 1965);
  add(&shelf, 1937);
  add(&shelf, 1813);
  printf("%d %d %d %d\\n", shelf.count, shelf.books[0].year, shelf.books[1].year, shelf.books[2].year);
  free(shelf.books);`,
          `${SHELF}
void add(Shelf *shelf, int year) {
  Book *grown = realloc(shelf->books, (shelf->count + 1) * sizeof(Book));
  if (grown == NULL) {
    return;
  }
  shelf->books = grown;
  shelf->books[shelf->count].year = year;
  shelf->books[shelf->count].pages = 0;
  shelf->count++;
}`
        )
      )
    ).toBe('3 1965 1937 1813\n');
  });

  it('stores a whole structure through the member', async () => {
    expect(
      await outputOf(
        program(
          `  Shelf shelf;
  Book added = {1965, 412};
  Book *grown = malloc(sizeof(Book));
  shelf.books = grown;
  shelf.books[0] = added;
  added.year = 1;
  printf("%d %d %d\\n", shelf.books[0].year, grown->pages, added.year);
  free(grown);`,
          SHELF
        )
      )
    ).toBe('1965 412 1\n');
  });

  it('leaves the values of an int block alone when a char pointer takes it', async () => {
    expect(
      await outputOf(
        program(`  int *a = malloc(2 * sizeof(int));
  a[0] = 300;
  char *c;
  c = (char *)a;
  a[1] = 300;
  printf("%d %d %d\\n", a[0], a[1], c != NULL);
  free(a);`)
      )
    ).toBe('300 300 1\n');
  });
});

describe('a member of a typedef enumeration type', () => {
  const code = program(
    `  Book book;
  book.year = 3;
  Book *b = malloc(2 * sizeof(Book));
  b[0].year = 4;
  struct book tagged;
  tagged.year = 5;
  printf("%d %d %d\\n", book.year, b[0].year, tagged.year);
  free(b);`,
    `typedef enum { ON_SHELF, LENT, LOST } Status;
typedef struct { int year; Status status; } Book;
struct book { int year; Status status; };`
  );

  it('is left uninitialized on the stack and on the heap', async () => {
    expect(await outputOf(code)).toBe('3 4 5\n');
  });

  it('is drawn as uninitialized until it is written', async () => {
    const run = await exec(
      program(
        `  Book book;
  book.year = 3;
  printf("%d\\n", book.year);`,
        `typedef enum { ON_SHELF, LENT, LOST } Status;
typedef struct { int year; Status status; } Book;`
      )
    );
    expect(run.output).toBe('3\n');
    expect(valueOf(run.model, 'status')).toBe('uninitialized');
  });
});

describe('a member of an enumeration type on the canvas', () => {
  it('names its enumerator, as a variable of the type does', async () => {
    const run = await exec(
      program(
        `  struct book b = {1965, LENT};
  enum status alone = LENT;
  Copy c = {LOST};
  printf("%d %d %d\\n", b.status, alone, c.state);`,
        `enum status { ON_SHELF, LENT, LOST };
typedef enum status Status;
struct book { int year; enum status status; };
typedef struct { Status state; } Copy;`
      )
    );
    expect(run.output).toBe('1 1 2\n');
    expect(valueOf(run.model, 'alone')).toBe('LENT (1)');
    expect(valueOf(run.model, 'status')).toBe('LENT (1)');
    expect(valueOf(run.model, 'state')).toBe('LOST (2)');
  });
});
