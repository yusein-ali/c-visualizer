import { CellModel, StepModel } from '../src/core';
import { exec, outputOf, rowNamed, typeOf, valueOf } from './library';

/**
 * Unions whose members share their bytes, as C stores them on the
 * little-endian machine the course grades on: writing one member and reading
 * another reads the same bytes through the second member's type. Each member
 * of a union is a view of one block of `sizeof` bytes, so the canvas draws
 * the union as one row with every member at its address.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdint.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const WORD = 'union word { uint32_t value; uint8_t bytes[4]; };';
const NUM = 'union num { int i; float f; };';

describe('sizeof a union', () => {
  it('is the size of its widest member', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  printf("%d %d\\n", (int)sizeof w, (int)sizeof(union word));`,
          WORD
        )
      )
    ).toBe('4 4\n');
  });

  it('counts an unsigned char array member a byte an element', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  printf("%d\\n", (int)sizeof w);`,
          'union word { uint32_t value; unsigned char bytes[4]; };'
        )
      )
    ).toBe('4\n');
  });

  it('rounds up to the alignment of its most aligned member', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d %d %d %d\\n", (int)sizeof(union a), (int)sizeof(union b),
         (int)sizeof(union c), (int)sizeof(union d), (int)sizeof(union e));`,
          `union a { char c; double d; };
union b { char c[5]; int i; };
union c { char c[9]; double d; };
union d { char c; uint16_t s; };
union e { char c[3]; };`
        )
      )
    ).toBe('8 8 16 2 3\n');
  });

  it('places a union member of a structure at the union alignment', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d\\n", (int)sizeof(struct tagged), (int)sizeof(struct wide));`,
          `${NUM}
struct tagged { char kind; union num as; };
union big { char c; double d; };
struct wide { char kind; union big as; };`
        )
      )
    ).toBe('8 16\n');
  });

  it('is counted once per element of an array of unions', async () => {
    expect(
      await outputOf(
        program(
          `  union word ws[3];
  printf("%d %d\\n", (int)sizeof ws, (int)(sizeof ws / sizeof ws[0]));`,
          WORD
        )
      )
    ).toBe('12 3\n');
  });

  it('sizes exact-width members by their width in a structure too', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d\\n", (int)sizeof(struct packet), (int)sizeof(struct mixed));`,
          `typedef unsigned char byte;
struct packet { uint8_t bytes[4]; uint16_t length; };
struct mixed { byte flag; int64_t big; };`
        )
      )
    ).toBe('6 16\n');
  });
});

describe('one member written, another read', () => {
  it('reads an integer back as its bytes, least significant first', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0x01020304;
  printf("%x %x %x %x\\n", w.bytes[0], w.bytes[1], w.bytes[2], w.bytes[3]);`,
          WORD
        )
      )
    ).toBe('4 3 2 1\n');
  });

  it('reads the last byte of an unsigned char array member', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0x01020304;
  printf("%d\\n", w.bytes[3]);`,
          'union word { uint32_t value; unsigned char bytes[4]; };'
        )
      )
    ).toBe('1\n');
  });

  it('reads bytes written one at a time back as an integer', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.bytes[0] = 7;
  w.bytes[1] = 0;
  w.bytes[2] = 0;
  w.bytes[3] = 0;
  printf("%u\\n", w.value);
  w.bytes[0] = 0x78;
  w.bytes[1] = 0x56;
  w.bytes[2] = 0x34;
  w.bytes[3] = 0x12;
  printf("%x\\n", w.value);`,
          WORD
        )
      )
    ).toBe('7\n12345678\n');
  });

  it('changes one byte of an integer without touching the others', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0x01020304;
  w.bytes[1] = 0xAB;
  printf("%x\\n", w.value);
  w.bytes[3]++;
  printf("%x\\n", w.value);`,
          WORD
        )
      )
    ).toBe('102ab04\n202ab04\n');
  });

  it('reinterprets the bits of a float as an int, and back', async () => {
    expect(
      await outputOf(
        program(
          `  union num n;
  n.f = 1.0f;
  printf("%x\\n", n.i);
  n.i = 0x40490fdb;
  printf("%.5f\\n", n.f);
  n.i = 0xc0000000;
  printf("%.1f\\n", n.f);`,
          NUM
        )
      )
    ).toBe('3f800000\n3.14159\n-2.0\n');
  });

  it('reads the bits of a double as a 64-bit integer', async () => {
    expect(
      await outputOf(
        program(
          `  union bits b;
  b.d = 1.0;
  printf("%x %x\\n", b.half[0], b.half[1]);
  b.half[1] = 0x40000000;
  printf("%.1f\\n", b.d);`,
          'union bits { double d; uint64_t u; uint32_t half[2]; };'
        )
      )
    ).toBe('0 3ff00000\n2.0\n');
  });

  it('writes a smaller integer over the low bytes of a larger one', async () => {
    expect(
      await outputOf(
        program(
          `  union reg r;
  r.whole = 0x12345678;
  r.low = 0xFF;
  printf("%x\\n", r.whole);
  r.half = 0xABCD;
  printf("%x %x\\n", r.whole, r.low);`,
          'union reg { uint32_t whole; uint16_t half; uint8_t low; };'
        )
      )
    ).toBe('123456ff\n1234abcd cd\n');
  });

  it('reads a byte through the signedness of the member that reads it', async () => {
    expect(
      await outputOf(
        program(
          `  union sign b;
  b.u = 200;
  printf("%d %d\\n", b.s, b.u);`,
          'union sign { int8_t s; uint8_t u; };'
        )
      )
    ).toBe('-56 200\n');
  });

  it('shares the bytes written through a pointer to a member', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0;
  uint8_t *p = w.bytes;
  p[3] = 0xAA;
  *(p + 1) = 0x11;
  printf("%x\\n", w.value);`,
          WORD
        )
      )
    ).toBe('aa001100\n');
  });

  it('shares the bytes a library function writes into a member', async () => {
    expect(
      await outputOf(
        program(
          `  union text t;
  strcpy(t.s, "abc");
  printf("%x\\n", t.value);
  memset(t.s, 'z', 2);
  printf("%x %s\\n", t.value, t.s);`,
          'union text { char s[4]; uint32_t value; };'
        )
      )
    ).toBe('636261\n637a7a zzc\n');
  });
});

describe('unions inside structures, and structures inside unions', () => {
  it('shares the bytes of a union that is a member of a structure', async () => {
    expect(
      await outputOf(
        program(
          `  struct tagged t;
  t.kind = 'f';
  t.as.f = 1.0f;
  printf("%c %x\\n", t.kind, t.as.i);`,
          `${NUM}
struct tagged { char kind; union num as; };`
        )
      )
    ).toBe('f 3f800000\n');
  });

  it('lays a structure member over the bytes of the other members', async () => {
    expect(
      await outputOf(
        program(
          `  union reg r;
  r.whole = 0x1234;
  printf("%x %x\\n", r.parts.lo, r.parts.hi);
  r.parts.hi = 0xAB;
  printf("%x\\n", r.whole);`,
          `struct halves { uint8_t lo; uint8_t hi; };
union reg { uint16_t whole; struct halves parts; };`
        )
      )
    ).toBe('34 12\nab34\n');
  });

  it('places structure members at their aligned offsets', async () => {
    expect(
      await outputOf(
        program(
          `  union over o;
  memset(o.raw, 0, sizeof o.raw);
  o.p.c = 'A';
  o.p.i = 0x01020304;
  printf("%d %d %d %d %d %d\\n", (int)sizeof o, o.raw[0], o.raw[4],
         o.raw[5], o.raw[6], o.raw[7]);`,
          `struct padded { char c; int i; };
union over { struct padded p; unsigned char raw[8]; };`
        )
      )
    ).toBe('8 65 4 3 2 1\n');
  });

  it('shares the bytes of a union inside a union', async () => {
    expect(
      await outputOf(
        program(
          `  union outer o;
  o.whole = 0x11223344;
  printf("%x %x\\n", o.inner.low, o.inner.raw[1]);
  o.inner.raw[0] = 0x55;
  printf("%x\\n", o.whole);`,
          `union inner { uint16_t low; uint8_t raw[2]; };
union outer { uint32_t whole; union inner inner; };`
        )
      )
    ).toBe('3344 33\n11223355\n');
  });
});

describe('an array of unions', () => {
  it('gives every element its own bytes', async () => {
    expect(
      await outputOf(
        program(
          `  union word ws[2];
  ws[0].value = 0x0A0B0C0D;
  ws[1].value = 0x01020304;
  ws[1].bytes[0] = 9;
  printf("%x %x %x\\n", ws[0].bytes[0], ws[1].value, ws[0].value);`,
          WORD
        )
      )
    ).toBe('d 1020309 a0b0c0d\n');
  });

  it('initializes each element through its first member', async () => {
    expect(
      await outputOf(
        program(
          `  union word ws[2] = {{0x01020304}, {0x05060708}};
  printf("%x %x\\n", ws[0].bytes[3], ws[1].bytes[0]);`,
          WORD
        )
      )
    ).toBe('1 8\n');
  });

  it('is reached through a pointer to its elements', async () => {
    expect(
      await outputOf(
        program(
          `  union word ws[3];
  union word *p = ws;
  for (int i = 0; i < 3; i++) {
    p[i].value = 0x100 * (i + 1);
  }
  p++;
  printf("%x %x\\n", p->bytes[1], (p + 1)->bytes[1]);`,
          WORD
        )
      )
    ).toBe('2 3\n');
  });
});

describe('a union passed to a function', () => {
  it('is copied when passed by value', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0x01020304;
  printf("%x\\n", low(w));
  clobber(w);
  printf("%x\\n", w.value);`,
          `${WORD}
uint8_t low(union word w) { return w.bytes[0]; }
void clobber(union word w) {
  w.bytes[0] = 0xFF;
  printf("%x\\n", w.value);
}`
        )
      )
    ).toBe('4\n10203ff\n1020304\n');
  });

  it('shares its bytes inside the function it was passed to', async () => {
    expect(
      await outputOf(
        program(
          `  union num n;
  n.i = 0;
  show(n);`,
          `${NUM}
void show(union num n) {
  n.f = 1.0f;
  printf("%x\\n", n.i);
}`
        )
      )
    ).toBe('3f800000\n');
  });

  it('is changed through a pointer', async () => {
    expect(
      await outputOf(
        program(
          `  union word w;
  w.value = 0x01020304;
  set_low(&w, 0xFF);
  printf("%x %x\\n", w.value, w.bytes[0]);`,
          `${WORD}
void set_low(union word *w, uint8_t b) { w->bytes[0] = b; }`
        )
      )
    ).toBe('10203ff ff\n');
  });

  it('is returned by value', async () => {
    expect(
      await outputOf(
        program(
          `  union word w = make(0x0A0B0C0D);
  printf("%x\\n", w.bytes[0]);
  union word v;
  v = make(0x01020304);
  printf("%x\\n", v.bytes[3]);`,
          `${WORD}
union word make(uint32_t value) {
  union word w;
  w.value = value;
  return w;
}`
        )
      )
    ).toBe('d\n1\n');
  });
});

describe('a union copied whole', () => {
  it('is copied from a function that returns it into a new object', async () => {
    // The union returned is in the frame just popped, at the addresses the
    // new object is laid out over.
    expect(
      await outputOf(
        program(
          `  union num m = make();
  printf("%x\\n", m.i);`,
          `${NUM}
union num make(void) {
  union num n;
  n.f = 1.0f;
  return n;
}`
        )
      )
    ).toBe('3f800000\n');
  });

  it('is copied by memcpy, every byte of an array member included', async () => {
    expect(
      await outputOf(
        program(
          `  union text a, b;
  strcpy(a.s, "abcdefg");
  b.value = 0;
  memcpy(&b, &a, sizeof a);
  printf("%s %x\\n", b.s, b.value);`,
          'union text { char s[8]; uint32_t value; };'
        )
      )
    ).toBe('abcdefg 64636261\n');
  });

  it('is copied by assignment', async () => {
    expect(
      await outputOf(
        program(
          `  union word a, b;
  a.value = 0x01020304;
  b = a;
  b.bytes[0] = 9;
  printf("%x %x\\n", a.value, b.value);`,
          WORD
        )
      )
    ).toBe('1020304 1020309\n');
  });

  it('shares the copying of a structure with an array member', async () => {
    // A union's members are copied as a structure's are, so the copies a
    // union needs are checked on a structure too.
    expect(
      await outputOf(
        program(
          `  struct named n = {7, "ab"};
  show(n);
  printf("%c\\n", n.name[0]);
  struct named m = make();
  show(m);
  struct named c;
  memcpy(&c, &n, sizeof n);
  show(c);`,
          `struct named { int n; char name[4]; };
void show(struct named s) {
  printf("%d %s\\n", s.n, s.name);
  s.name[0] = 'Z';
}
struct named make(void) {
  struct named s = {3, "hi"};
  return s;
}`
        )
      )
    ).toBe('7 ab\na\n3 hi\n7 ab\n');
  });
});

describe('union initializers', () => {
  it('initializes the first member', async () => {
    expect(
      await outputOf(
        program(
          `  union word w = {0x01020304};
  union num n = {0x3f800000};
  printf("%x %.1f\\n", w.bytes[0], n.f);`,
          `${WORD}
${NUM}`
        )
      )
    ).toBe('4 1.0\n');
  });

  it('zeroes the bytes a smaller first member does not cover', async () => {
    expect(
      await outputOf(
        program(
          `  union small s = {0xFF};
  printf("%x\\n", s.w);`,
          'union small { uint8_t b; uint32_t w; };'
        )
      )
    ).toBe('ff\n');
  });

  it('initializes the member a designator names', async () => {
    expect(
      await outputOf(
        program(
          `  union num n = {.f = 2.0f};
  union word w = {.bytes = {1, 2, 3, 4}};
  printf("%x %x\\n", n.i, w.value);`,
          `${WORD}
${NUM}`
        )
      )
    ).toBe('40000000 4030201\n');
  });

  it('initializes a union member of a structure by designator', async () => {
    expect(
      await outputOf(
        program(
          `  struct tagged t = {.kind = 'f', .as = {.f = 1.0f}};
  printf("%c %x\\n", t.kind, t.as.i);`,
          `${NUM}
struct tagged { char kind; union num as; };`
        )
      )
    ).toBe('f 3f800000\n');
  });

  it('zeroes a union with static storage duration', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %.1f\\n", g.i, g.f);
  g.f = 1.0f;
  printf("%x\\n", g.i);`,
          `${NUM}
union num g;`
        )
      )
    ).toBe('0 0.0\n3f800000\n');
  });

  it('initializes the members of a structure a designator names', async () => {
    expect(
      await outputOf(
        program(
          `  struct point p = {.y = 2, .x = 1};
  struct point q = {.y = 5};
  printf("%d %d %d %d\\n", p.x, p.y, q.x, q.y);`,
          'struct point { int x; int y; };'
        )
      )
    ).toBe('1 2 0 5\n');
  });
});

describe('a tagged union', () => {
  const tagged = `enum kind { INTEGER, REAL, TEXT };
union payload { int i; double d; char s[8]; };
struct value { enum kind kind; union payload as; };

void print(struct value v) {
  switch (v.kind) {
  case INTEGER:
    printf("int %d\\n", v.as.i);
    break;
  case REAL:
    printf("real %.2f\\n", v.as.d);
    break;
  case TEXT:
    printf("text %s\\n", v.as.s);
    break;
  }
}`;

  it('reads the member its tag says is there', async () => {
    expect(
      await outputOf(
        program(
          `  struct value vs[3];
  vs[0].kind = INTEGER;
  vs[0].as.i = 42;
  vs[1].kind = REAL;
  vs[1].as.d = 2.5;
  vs[2].kind = TEXT;
  strcpy(vs[2].as.s, "hi");
  for (int i = 0; i < 3; i++) {
    print(vs[i]);
  }`,
          tagged
        )
      )
    ).toBe('int 42\nreal 2.50\ntext hi\n');
  });

  it('is initialized through its tag and a designated member', async () => {
    expect(
      await outputOf(
        program(
          `  struct value v = {REAL, {.d = 0.75}};
  print(v);
  v.kind = INTEGER;
  v.as.i = 7;
  print(v);`,
          tagged
        )
      )
    ).toBe('real 0.75\nint 7\n');
  });
});

/** The rows the memory view draws for the stack segment. */
const stackRows = (model: StepModel): CellModel[][] =>
  model.memory.find((segment) => segment.key === 'stack')!.rows;

const cellOf = (row: CellModel[], kind: CellModel['kind']): CellModel =>
  row.find((cell) => cell.kind === kind)!;

const addressOf = (model: StepModel, name: string): number =>
  cellOf(rowNamed(model, name), 'address').address!;

const sizeOf = (model: StepModel, name: string): number =>
  cellOf(rowNamed(model, name), 'type').size!;

describe('the canvas', () => {
  const run = () =>
    exec(
      program(
        `  union word w;
  w.value = 0x01020304;
  int after = 9;`,
        WORD
      )
    );

  it('draws the union as one row of its own size', async () => {
    const { model } = await run();
    expect(typeOf(model, 'w')).toBe('union word');
    expect(sizeOf(model, 'w')).toBe(4);
    // The next object starts where the union's four bytes end.
    expect(addressOf(model, 'after')).toBe(addressOf(model, 'w') + 4);
  });

  it('draws every member at the address of the union', async () => {
    const { model } = await run();
    const base = addressOf(model, 'w');
    expect(addressOf(model, 'value')).toBe(base);
    expect(addressOf(model, 'bytes')).toBe(base);
    expect(sizeOf(model, 'value')).toBe(4);
    expect(sizeOf(model, 'bytes')).toBe(4);
  });

  it('draws each member holding the bytes the union holds', async () => {
    const { model } = await run();
    const base = addressOf(model, 'w');
    expect(valueOf(model, 'value')).toBe('16909060');
    [4, 3, 2, 1].forEach((byte, index) => {
      expect(valueOf(model, `bytes[${index}]`)).toBe(String(byte));
      expect(addressOf(model, `bytes[${index}]`)).toBe(base + index);
      expect(sizeOf(model, `bytes[${index}]`)).toBe(1);
    });
  });

  it('lists the members under the union in the memory view', async () => {
    const { model } = await run();
    const rows = stackRows(model);
    const at = rows.findIndex((row) => cellOf(row, 'name')?.text === 'w');
    expect(at).not.toBe(-1);
    const union = rows[at];
    const members = rows
      .slice(at + 1, at + 7)
      .map((row) => [cellOf(row, 'name').text, cellOf(row, 'address').address]);
    const base = cellOf(union, 'address').address!;
    expect(members).toEqual([
      ['value', base],
      ['bytes', base],
      ['bytes[0]', base],
      ['bytes[1]', base + 1],
      ['bytes[2]', base + 2],
      ['bytes[3]', base + 3],
    ]);
    // Every member row is folded under the union's own row.
    const group = cellOf(union, 'fold').foldTarget;
    expect(group).toBeDefined();
    for (const row of rows.slice(at + 1, at + 7)) {
      expect(cellOf(row, 'name').foldGroup?.startsWith(group!)).toBe(true);
    }
  });

  it('draws a union member of a structure over its own bytes', async () => {
    const { model } = await exec(
      program(
        `  struct tagged t;
  t.kind = 'r';
  t.r.whole = 0x1234;`,
        `struct halves { uint8_t lo; uint8_t hi; };
union reg { uint16_t whole; struct halves parts; };
struct tagged { char kind; union reg r; };`
      )
    );
    const base = addressOf(model, 't');
    expect(sizeOf(model, 't')).toBe(4);
    // Aligned as its uint16_t member is, and as wide.
    expect(addressOf(model, 'r')).toBe(base + 2);
    expect(sizeOf(model, 'r')).toBe(2);
    expect(addressOf(model, 'whole')).toBe(base + 2);
    expect(addressOf(model, 'parts')).toBe(base + 2);
    expect(addressOf(model, 'lo')).toBe(base + 2);
    expect(addressOf(model, 'hi')).toBe(base + 3);
    expect(valueOf(model, 'lo')).toBe('52');
    expect(valueOf(model, 'hi')).toBe('18');
  });

  it('draws a float member reinterpreting the bits of an int member', async () => {
    const { model } = await exec(
      program(
        `  union num n;
  n.f = 1.0f;`,
        NUM
      )
    );
    expect(valueOf(model, 'i')).toBe('1065353216');
    expect(Number(valueOf(model, 'f'))).toBe(1);
    expect(addressOf(model, 'i')).toBe(addressOf(model, 'n'));
    expect(addressOf(model, 'f')).toBe(addressOf(model, 'n'));
  });
});
