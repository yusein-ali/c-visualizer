import { exec, outputOf, rulesOf } from './library';

/**
 * A structure's bytes, as C lays them out.
 *
 * The engine keeps a structure as a descriptor word followed by its members,
 * packed with no padding, and a nested structure with a descriptor of its
 * own. `fwrite(&s, sizeof s, 1, f)` wrote the descriptor's four bytes first
 * and lost the last member, `fread` into a structure changed nothing, and a
 * `char *` into a structure read the descriptor and then stopped the program.
 * Every expected output below is gcc's on a 32-bit little-endian target, the
 * model this interpreter follows.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const DUMP = `static void dump(const void *object, size_t size) {
  const unsigned char *p = object;
  for (size_t i = 0; i < size; i++) {
    printf("%02x ", p[i]);
  }
  printf("\\n");
}`;

describe('fwrite and fread of a structure', () => {
  it('write the bytes C has, and read them back into the members', async () => {
    const run = await exec(
      program(
        `  struct record one = { "Dune", 1965 };
  FILE *out = fopen("d.bin", "wb");
  fwrite(&one, sizeof one, 1, out);
  fclose(out);
  struct record back = { "", 0 };
  FILE *in = fopen("d.bin", "rb");
  size_t got = fread(&back, sizeof back, 1, in);
  fclose(in);
  FILE *again = fopen("d.bin", "rb");
  int c;
  while ((c = fgetc(again)) != EOF) {
    printf("%02x ", c);
  }
  fclose(again);
  printf("\\n%zu [%s] %d\\n", got, back.title, back.year);`,
        'struct record { char title[8]; int year; };'
      )
    );
    expect(run.output).toBe(
      '44 75 6e 65 00 00 00 00 ad 07 00 00 \n1 [Dune] 1965\n'
    );
    expect(rulesOf(run)).toEqual([]);
  });

  it('write two ints in order', async () => {
    expect(
      await outputOf(
        program(
          `  struct rec r = {7, 9};
  FILE *out = fopen("r.bin", "wb");
  fwrite(&r, sizeof r, 1, out);
  fclose(out);
  FILE *in = fopen("r.bin", "rb");
  int c;
  while ((c = fgetc(in)) != EOF) {
    printf("%d ", c);
  }
  fclose(in);
  printf("\\n");`,
          'struct rec { int y; int p; };'
        )
      )
    ).toBe('7 0 0 0 9 0 0 0 \n');
  });

  it('write an array of structures with one call and read it back', async () => {
    expect(
      await outputOf(
        program(
          `  struct item stock[3] = {{"nut", 4, 25}, {"bolt", 10, 40}, {"gear", 2, 900}};
  FILE *out = fopen("stock.bin", "wb");
  size_t wrote = fwrite(stock, sizeof stock[0], 3, out);
  fclose(out);
  struct item back[3] = {{"", 0, 0}};
  FILE *in = fopen("stock.bin", "rb");
  size_t got = fread(back, sizeof back[0], 3, in);
  fclose(in);
  printf("%zu %zu %zu\\n", sizeof stock[0], wrote, got);
  for (int i = 0; i < 3; i++) {
    printf("%s %d %d\\n", back[i].name, back[i].qty, back[i].price);
  }
  struct item one = {"", 0, 0};
  in = fopen("stock.bin", "rb");
  fseek(in, (long)sizeof one, SEEK_SET);
  printf("%zu ", fread(&one, sizeof one, 1, in));
  fclose(in);
  printf("%s %d %d\\n", one.name, one.qty, one.price);
  FILE *again = fopen("stock.bin", "rb");
  int c, n = 0;
  while ((c = fgetc(again)) != EOF) {
    if (n < 12) {
      printf("%02x ", c);
    }
    n++;
  }
  fclose(again);
  printf("| %d\\n", n);`,
          'struct item { char name[6]; short qty; int price; };'
        )
      )
    ).toBe(
      '12 3 3\nnut 4 25\nbolt 10 40\ngear 2 900\n1 bolt 10 40\n' +
        '6e 75 74 00 00 00 04 00 19 00 00 00 | 36\n'
    );
  });
});

describe('a character pointer into a structure', () => {
  it('reads every byte, a char array last', async () => {
    expect(
      await outputOf(
        program(
          `  struct rec r = { 7, "AB" };
  const unsigned char *p = (const unsigned char *)&r;
  for (size_t i = 0; i < sizeof r; ++i) {
    printf(" %d", p[i]);
  }
  printf("\\n");`,
          'struct rec { int y; char t[4]; };'
        )
      )
    ).toBe(' 7 0 0 0 65 66 0 0\n');
  });

  it('reads padding, a char array first and a nested structure', async () => {
    expect(
      await outputOf(
        program(
          `  struct pad a = {'A', 0x01020304, 0x0506};
  struct tail t = {7, "abcd"};
  struct outer o = {'T', {'b', 9}, 'Z'};
  dump(&a, sizeof a);
  dump(&t, sizeof t);
  dump(&o, sizeof o);
  const char *c = (const char *)&t;
  printf("%c%c %d\\n", c[4], c[7], (int)(c + 4 - (const char *)&t));`,
          `struct pad { char c; int i; short s; };
struct tail { int n; char name[5]; };
struct inner { char a; int b; };
struct outer { char tag; struct inner in; char z; };
${DUMP}`
        )
      )
    ).toBe(
      '41 00 00 00 04 03 02 01 06 05 00 00 \n' +
        '07 00 00 00 61 62 63 64 00 00 00 00 \n' +
        '54 00 00 00 62 00 00 00 09 00 00 00 5a 00 00 00 \n' +
        'ad 4\n'
    );
  });

  it('writes bytes of members and of padding', async () => {
    expect(
      await outputOf(
        program(
          `  struct pad a = {'A', 0x01020304, 0x0506};
  unsigned char *w = (unsigned char *)&a;
  w[4] = 0xff;
  w[8] = 0x07;
  w[1] = 0x55;
  printf("%x %x %d\\n", (unsigned)a.i, (unsigned)a.s, w[1]);
  dump(&a, sizeof a);`,
          `struct pad { char c; int i; short s; };
${DUMP}`
        )
      )
    ).toBe('10203ff 507 85\n41 55 00 00 ff 03 02 01 07 05 00 00 \n');
  });

  it('walks to the end of a structure with padding and counts its bytes', async () => {
    expect(
      await outputOf(
        program(
          `  struct outer o = {'T', {'b', 9}, 'Z'};
  int count = 0;
  for (const unsigned char *q = (const unsigned char *)&o;
       q < (const unsigned char *)&o + sizeof o; q++) {
    count++;
  }
  printf("%d %d\\n", count,
         (int)((const unsigned char *)&o.z - (const unsigned char *)&o));`,
          `struct inner { char a; int b; };
struct outer { char tag; struct inner in; char z; };`
        )
      )
    ).toBe('16 12\n');
  });

  it('reaches the next element of an array as base + i * size does', async () => {
    expect(
      await outputOf(
        program(
          `  Book shelf[] = {{"Dune", 1965}, {"The Hobbit", 1937}};
  const unsigned char *bytes = (const unsigned char *)shelf;
  const Book *second = (const Book *)(bytes + sizeof shelf[0]);
  printf("%d %s\\n", second->year, second->title);`,
          'typedef struct book { char *title; int year; } Book;'
        )
      )
    ).toBe('1937 The Hobbit\n');
  });

  it('swaps two structures byte by byte, pointer member and all', async () => {
    const run = await exec(
      program(
        `  Book shelf[] = {{"Dune", 1965}, {"The Hobbit", 1937}};
  unsigned char *a = (unsigned char *)&shelf[0], *b = (unsigned char *)&shelf[1];
  for (size_t i = 0; i < sizeof shelf[0]; i++) {
    unsigned char held = a[i];
    a[i] = b[i];
    b[i] = held;
  }
  printf("%s %d %s %d\\n", shelf[0].title, shelf[0].year, shelf[1].title, shelf[1].year);`,
        'typedef struct book { char *title; int year; } Book;'
      )
    );
    expect(run.output).toBe('The Hobbit 1937 Dune 1965\n');
    expect(rulesOf(run)).toEqual([]);
  });

  it('sorts with a generic swap over (char *)base + i * size', async () => {
    expect(
      await outputOf(
        program(
          `  struct rec r[4] = {{3, 'c'}, {1, 'a'}, {4, 'd'}, {2, 'b'}};
  sort(r, 4, sizeof r[0], by_key);
  for (int i = 0; i < 4; i++) {
    printf("%d%c ", r[i].key, r[i].tag);
  }
  printf("\\n");`,
          `struct rec { int key; char tag; };
static void swap(void *left, void *right, size_t size) {
  unsigned char *p = left, *q = right;
  while (size--) {
    unsigned char t = *p;
    *p++ = *q;
    *q++ = t;
  }
}
static void sort(void *base, size_t count, size_t size,
                 int (*cmp)(const void *, const void *)) {
  for (size_t i = 0; i < count; i++) {
    for (size_t j = 0; j + 1 < count - i; j++) {
      char *a = (char *)base + j * size, *b = a + size;
      if (cmp(a, b) > 0) {
        swap(a, b, size);
      }
    }
  }
}
static int by_key(const void *a, const void *b) {
  const struct rec *x = a, *y = b;
  return (x->key > y->key) - (x->key < y->key);
}`
        )
      )
    ).toBe('1a 2b 3c 4d \n');
  });
});

describe('the mem functions over a structure and a buffer of bytes', () => {
  it('copy a structure out to bytes and back, and compare', async () => {
    const run = await exec(
      program(
        `  struct pad a = {'A', 0x01020304, 0x0506};
  struct pad b;
  unsigned char buffer[12];
  memcpy(buffer, &a, sizeof a);
  buffer[0] = 'B';
  memcpy(&b, buffer, sizeof b);
  printf("%c %x %x %d\\n", b.c, (unsigned)b.i, (unsigned)b.s,
         memcmp(&a, &b, sizeof a) < 0);`,
        'struct pad { char c; int i; short s; };'
      )
    );
    expect(run.output).toBe('B 1020304 506 1\n');
    expect(rulesOf(run)).toEqual([]);
  });
});

describe('a padding byte', () => {
  it('reads as 0 in a structure an initializer filled', async () => {
    const run = await exec(
      program(
        `  struct pad a = {'A', 1};
  const unsigned char *p = (const unsigned char *)&a;
  printf("%d %d\\n", p[1], p[3]);`,
        'struct pad { char c; int i; };'
      )
    );
    expect(run.output).toBe('0 0\n');
    expect(rulesOf(run)).toEqual([]);
  });

  it('is said to be indeterminate in one nothing has written', async () => {
    const run = await exec(
      program(
        `  struct pad a;
  a.c = 'A';
  a.i = 1;
  const unsigned char *p = (const unsigned char *)&a;
  printf("%d %d\\n", p[0], p[1]);`,
        'struct pad { char c; int i; };'
      )
    );
    expect(run.output).toBe('65 0\n');
    expect(rulesOf(run)).toEqual(['uninitialized-read']);
  });
});
