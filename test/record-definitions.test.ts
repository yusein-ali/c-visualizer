import { exec, outputOf, typeOf, valueOf } from './library';

/**
 * Where a structure or union type may be defined besides file scope: inline
 * as the type of a member - the tagged union, `struct message { ...; union {
 * ... } value; }` - and inside a function body.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

const MESSAGE = `enum kind { TEMPERATURE, DOOR };
struct message {
  int sensor;
  enum kind kind;
  union {
    double celsius;
    int open;
  } value;
};`;

describe('a record type defined as the type of a member', () => {
  it('runs the tagged-union idiom', async () => {
    expect(
      await outputOf(
        program(
          `  struct message m[2];
  m[0].sensor = 12;
  m[0].kind = TEMPERATURE;
  m[0].value.celsius = 21.5;
  m[1].kind = DOOR;
  m[1].value.open = 1;
  printf("%d %.1f %d\\n", m[0].sensor, m[0].value.celsius, m[1].value.open);`,
          MESSAGE
        )
      )
    ).toBe('12 21.5 1\n');
  });

  it('shares the bytes of the union members and sizes the structure', async () => {
    expect(
      await outputOf(
        program(
          `  struct message m = {3, DOOR, {0.0}};
  m.value.open = 1;
  struct message *p = &m;
  printf("%d %d %d %d\\n", p->value.open, p->sensor, (int)sizeof m.value, (int)sizeof(struct message));`,
          MESSAGE
        )
      )
    ).toBe('1 3 8 16\n');
  });

  it('defines a tagged structure inside another, usable by its tag', async () => {
    expect(
      await outputOf(
        program(
          `  struct outer o;
  o.in.a = 4;
  o.b = 5;
  struct inner i = o.in;
  printf("%d %d %d\\n", o.in.a, o.b, i.a);`,
          'struct outer { struct inner { int a; } in; int b; };'
        )
      )
    ).toBe('4 5 4\n');
  });

  it('gives several members the inline type', async () => {
    expect(
      await outputOf(
        program(
          `  struct pair p;
  p.first.x = 1;
  p.second.x = 2;
  printf("%d %d\\n", p.first.x, p.second.x);`,
          'struct pair { struct { int x; } first, second; };'
        )
      )
    ).toBe('1 2\n');
  });

  it('draws the member with its own members', async () => {
    const run = await exec(
      program(
        `  struct message m;
  m.value.celsius = 21.5;
  printf("%.1f\\n", m.value.celsius);`,
        MESSAGE
      )
    );
    expect(run.output).toBe('21.5\n');
    expect(typeOf(run.model, 'value')).toBe('union <anonymous>');
    expect(valueOf(run.model, 'celsius')).toBe('21.5');
  });
});

describe('a record type defined inside a function', () => {
  it('declares objects of a structure and a union defined in main', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void)
{
	struct point { int x; int y; } p = {1, 2};
	union word { int i; char c; } w;
	w.i = 65;
	printf("%d %d %c\\n", p.x, p.y, w.c);
	return 0;
}`)
    ).toBe('1 2 A\n');
  });

  it('uses a type defined on its own line of a function', async () => {
    expect(
      await outputOf(
        program(`  struct point { int x; int y; };
  struct point a = {3, 4};
  struct point *p = &a;
  typedef struct { int n; } Counter;
  Counter c = {5};
  printf("%d %d %d\\n", p->x, a.y, c.n);`)
      )
    ).toBe('3 4 5\n');
  });

  it('uses a type defined in a function other than main', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d\\n", sum());`,
          `int sum(void) {
  struct pair { int a; int b; } p = {2, 3};
  return p.a + p.b;
}`
        )
      )
    ).toBe('5\n');
  });
});

describe('a structure without a tag that declares an object', () => {
  it('lays the object out, at file scope and in a block', async () => {
    const run = await exec(`#include <stdio.h>
struct { int a; double d; } s;
static struct { char c; } quiet;
int main(void)
{
	s.a = 2;
	s.d = 1.5;
	struct { int b; } t;
	t.b = 3;
	struct { int x, y; } p = {4, 5}, q;
	q = p;
	printf("%d %.1f %d %d %d %d\\n", s.a, s.d, t.b, q.y, quiet.c, (int)sizeof s);
	return 0;
}`);
    expect(run.output).toBe('2 1.5 3 5 0 16\n');
    expect(run.runtime).toEqual([]);
    expect(typeOf(run.model, 's')).toBe('struct <anonymous>');
  });
});
