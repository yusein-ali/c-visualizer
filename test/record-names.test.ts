import { exec, outputOf, typeOf } from './library';

/**
 * Structure and union tags have a name space of their own (C11 6.2.3), so
 * `struct book book;` declares an object `book` of type `struct book`. The
 * engine filed a record's layout under its tag among the program's objects,
 * and an object of the same name hid the layout from every declaration,
 * member access and copy that looked the type up by name.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const BOOK = 'typedef struct book { int year; int pages; } Book;';

describe('an object named as a structure tag', () => {
  it('runs the course example: objects and parameters named book', async () => {
    expect(
      await outputOf(
        program(
          `  Book book = {3, 4};
  struct book other;
  other.year = 5;
  printf("%d %d %d %d\\n", book.year, pages_of(book), year_of(&book), other.year);`,
          `${BOOK}
int pages_of(Book book) { return book.pages; }
int year_of(const struct book *book) { return book->year; }`
        )
      )
    ).toBe('3 4 3 5\n');
  });

  it('declares struct book book; and copies it', async () => {
    expect(
      await outputOf(
        program(
          `  struct book book;
  book.year = 1965;
  book.pages = 412;
  struct book copy = book;
  Book *p = &copy;
  printf("%d %d %d\\n", copy.year, p->pages, (int)sizeof(struct book));`,
          BOOK
        )
      )
    ).toBe('1965 412 8\n');
  });

  it('declares a pointer named as the tag and a heap block through it', async () => {
    expect(
      await outputOf(
        program(
          `  struct book *book = malloc(2 * sizeof(struct book));
  book[1].year = 7;
  book->pages = 8;
  printf("%d %d\\n", book[1].year, book[0].pages);
  free(book);`,
          BOOK
        )
      )
    ).toBe('7 8\n');
  });

  it('declares a file-scope object named as the tag', async () => {
    expect(
      await outputOf(
        program(
          `  struct book local = book;
  book.year = 2;
  printf("%d %d %d\\n", local.year, local.pages, book.year);`,
          `${BOOK}
struct book book = {1, 9};`
        )
      )
    ).toBe('1 9 2\n');
  });

  it('nests a structure whose tag names a member and an object', async () => {
    expect(
      await outputOf(
        program(
          `  struct shelf shelf;
  struct book book = {1, 2};
  shelf.book = book;
  shelf.book.pages = 3;
  printf("%d %d %d\\n", shelf.book.year, shelf.book.pages, book.pages);`,
          `${BOOK}
struct shelf { struct book book; int count; };`
        )
      )
    ).toBe('1 3 2\n');
  });

  it('does the same for a union tag', async () => {
    expect(
      await outputOf(
        program(
          `  union word word;
  word.i = 65;
  printf("%c\\n", word.c);`,
          'union word { int i; char c; };'
        )
      )
    ).toBe('A\n');
  });

  it('keeps the type as the reader wrote it on the canvas', async () => {
    const run = await exec(
      program(
        `  struct book book = {1, 2};
  Book other = book;
  printf("%d\\n", other.pages);`,
        BOOK
      )
    );
    expect(run.output).toBe('2\n');
    expect(typeOf(run.model, 'book')).toBe('struct book');
    expect(typeOf(run.model, 'other')).toBe('Book (struct)');
  });
});
