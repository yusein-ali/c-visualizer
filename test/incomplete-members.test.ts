import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { Response, Server } from '../src/core';
import { exec } from './library';

/**
 * A member's type must be complete where the member is declared (C11
 * 6.7.2.1p3): a structure is complete only after its definition's closing
 * brace. gcc refuses `struct author author;` in a structure defined before
 * `struct author` is; the interpreter ran it.
 */

const errorsOf = (code: string) =>
  new PlivetCPP14Interpreter().checkSyntaxError(code);

const AUTHOR_LATER = `#include <stdio.h>

struct author;

struct book {
	char *title;
	struct author author;
};

struct author {
	char *name;
};

int main(void)
{
	struct book b;
	b.title = "The Hobbit";
	b.author.name = "Tolkien";
	printf("%s by %s\\n", b.title, b.author.name);
	return 0;
}`;

describe('a member of an incomplete structure type', () => {
  it('is refused where it is declared', async () => {
    const errors = errorsOf(AUTHOR_LATER);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(7);
    expect(errors[0].msg).toMatch(/author has incomplete type struct author/);
    const run = await exec(AUTHOR_LATER);
    expect(run.output).toBe('');
  });

  it('is refused for a structure never defined, and for itself', () => {
    expect(
      errorsOf('struct a { struct missing m; };\nint main(void) { return 0; }')
    ).toHaveLength(1);
    expect(
      errorsOf(
        'struct node { int v; struct node next; };\nint main(void) { return 0; }'
      )
    ).toHaveLength(1);
  });

  it('accepts a pointer to it, and a member defined first or inline', () => {
    expect(
      errorsOf(`struct author;
struct book { struct author *author; struct inner { int x; } in; };
struct author { char *name; };
struct shelf { struct book books[2]; struct author a; };
typedef struct author Author;
struct loan { Author who; };
int main(void) { return 0; }`)
    ).toEqual([]);
  });
});

/**
 * A structure only declared in a file - `struct counter;` in the header it
 * includes, defined in another file - is incomplete there, and gcc refuses
 * a member access through it ("invalid use of undefined type"). The files
 * run as one unit, where a later file's definition is in view, and the
 * access ran.
 */
describe('a member of a structure defined in another file', () => {
  const header = (typedef: string) => ({
    path: 'counter.h',
    text: `#ifndef COUNTER_H
#define COUNTER_H
struct counter;
${typedef}
struct counter *counter_new(void);
void counter_add(struct counter *c);
int counter_value(const struct counter *c);
#endif
`,
  });
  const implementation = {
    path: 'counter.c',
    text: `#include <stdlib.h>
#include "counter.h"
struct counter {
  int value;
};
struct counter *counter_new(void) {
  struct counter *c = malloc(sizeof *c);
  c->value = 0;
  return c;
}
void counter_add(struct counter *c) { c->value++; }
int counter_value(const struct counter *c) { return c->value; }
`,
  };
  const runFiles = async (files: { path: string; text: string }[]) => {
    const server = new Server();
    const finished = new Promise<Response>((resolve) => {
      server.onRunEvent = (_event, response) => resolve(response);
    });
    const logged = console.log;
    console.log = () => undefined;
    try {
      const started = await server.send({
        controlEvent: 'Exec',
        sourcecode: files[0].text,
        files,
        entry: 'main.c',
      });
      return started.debugState === 'Executing' ? await finished : started;
    } finally {
      console.log = logged;
    }
  };
  const main = (body: string) => ({
    path: 'main.c',
    text: `#include <stdio.h>
#include "counter.h"
int main(void) {
  struct counter *c = counter_new();
  counter_add(c);
${body}
  printf("%d\\n", counter_value(c));
  return 0;
}
`,
  });

  it('runs a program that reaches the members through the functions only', async () => {
    const response = await runFiles([main(''), header(''), implementation]);
    expect(response.output).toBe('1\n');
    expect(response.runtime ?? []).toEqual([]);
  });

  it.each([
    ['c->value = 5;', 'c->value'],
    ['printf("%d\\n", (*c).value);', '(*c).value'],
  ])('refuses %s where the structure is only declared', async (body) => {
    const response = await runFiles([main(body), header(''), implementation]);
    expect(response.output).toMatch(/^c-visualizer stopped the program/);
    expect(
      (response.runtime ?? []).map(({ rule, message, line }) => ({
        rule,
        message,
        line,
      }))
    ).toEqual([
      {
        rule: 'incomplete-type',
        message:
          "invalid use of undefined type 'struct counter': main.c sees " +
          'only a declaration of it, without its members; they are ' +
          'defined in counter.c',
        line: expect.any(Number),
      },
    ]);
  });

  it('names the typedef the access goes through', async () => {
    const response = await runFiles([
      {
        path: 'main.c',
        text: `#include "counter.h"
int main(void) {
  Counter *c = counter_new();
  c->value = 2;
  return 0;
}
`,
      },
      header('typedef struct counter Counter;'),
      implementation,
    ]);
    expect((response.runtime ?? []).map(({ rule }) => rule)).toEqual([
      'incomplete-type',
    ]);
    expect(response.runtime?.[0].message).toMatch(
      /^invalid use of incomplete typedef 'Counter': main\.c sees only/
    );
  });

  it('accepts the access where a header the file includes defines it', async () => {
    const response = await runFiles([
      main('  c->value = 5;'),
      {
        path: 'counter.h',
        text: `struct counter { int value; };
struct counter *counter_new(void);
void counter_add(struct counter *c);
int counter_value(const struct counter *c);
`,
      },
      {
        path: 'counter.c',
        text: implementation.text.replace(
          /struct counter \{\n {2}int value;\n\};\n/,
          ''
        ),
      },
    ]);
    expect(response.output).toBe('5\n');
    expect(response.runtime ?? []).toEqual([]);
  });

  it.each([
    ['struct', 'typedef struct {\n  int count;\n} Queue, *QueuePtr;'],
    ['union', 'typedef union {\n  int count;\n  char byte;\n} Queue;'],
  ])(
    'accepts a tagless typedef %s that a shared header defines',
    async (_kind, definition) => {
      const response = await runFiles([
        {
          path: 'main.c',
          text: `#include <stdio.h>
#include "source.h"
int main(void) {
  Queue q;
  q.count = 0;
  bump(&q);
  printf("%d\\n", q.count);
  return 0;
}
`,
        },
        {
          path: 'source.h',
          text: `#ifndef SOURCE_H
#define SOURCE_H
${definition}
void bump(Queue *q);
#endif
`,
        },
        {
          path: 'source.c',
          text: `#include "source.h"
void bump(Queue *q) {
  q->count++;
}
`,
        },
      ]);
      expect(response.output).toBe('1\n');
      expect(response.runtime ?? []).toEqual([]);
    }
  );
});

/**
 * A pointer to a tag the program names but never defines - `struct nod
 * *next` for `struct node *next` - points to an incomplete type with no
 * members anywhere. gcc refuses the access through it; the engine read
 * whatever the address held, and printed the other structure's value.
 */
describe('a member through a pointer to a tag never defined', () => {
  it('is refused', async () => {
    const run = await exec(`#include <stdio.h>
struct node {
  int value;
  struct nod *next;
};
int main(void)
{
  struct node a = {1, NULL};
  struct node b = {2, NULL};
  a.next = (struct nod *)&b;
  printf("%d\\n", a.next->value);
  return 0;
}`);
    expect(
      run.runtime.map(({ rule, message, line }) => [rule, message, line])
    ).toEqual([
      [
        'incomplete-type',
        "invalid use of undefined type 'struct nod': no structure with " +
          'this tag is defined, so it has no members',
        11,
      ],
    ]);
    expect(run.output).not.toMatch(/^2/);
  });

  // gcc 14 refuses the assignment before it: a `struct node *` is not a
  // `struct nod *`.
  it('refuses a pointer to another structure assigned to it', async () => {
    const run = await exec(`#include <stdio.h>
struct node {
  int value;
  struct nod *next;
};
int main(void)
{
  struct node a = {1, NULL};
  struct node b = {2, NULL};
  a.next = NULL;
  a.next = &b;
  printf("%d\\n", a.next->value);
  return 0;
}`);
    expect(
      run.runtime.map(({ rule, message, line }) => [rule, message, line])
    ).toEqual([
      [
        'incompatible-pointer-types',
        "assignment to 'struct nod *' from incompatible pointer type " +
          "'struct node *': no structure with the tag nod is defined",
        11,
      ],
    ]);
  });

  it('leaves a tag defined later, or inside a function, alone', async () => {
    expect(
      (
        await exec(`#include <stdio.h>
struct later;
struct holder { struct later *p; };
struct later { int v; };
int main(void)
{
  struct local { int w; } l = {3};
  struct local *q = &l;
  struct later x = {4};
  struct holder h = {&x};
  printf("%d %d\\n", q->w, h.p->v);
  return 0;
}`)
      ).output
    ).toBe('3 4\n');
  });
});
