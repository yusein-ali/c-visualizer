import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { jscppCheck } from '../src/interpreter/jscpp/JscppSyntax';
import { typedefNamesIn } from '../src/interpreter/TypedefNames';
import { exec, outputOf, targetOf, typeOf } from './library';

/*
 * Statements only a typedef name makes ambiguous. unicoen's grammar read
 * `Node *head = NULL;` in a function as a multiplication and `(ptrdiff_t)-2`
 * as a subtraction; the jscpp check refused `(myint)x`.
 */

describe('the typedef names a program declares', () => {
  it('are read from every form of typedef', () => {
    expect(
      Array.from(
        typedefNamesIn(`typedef int myint, *intptr;
typedef struct node { int v; struct node *next; } Node;
typedef struct { int x; } Point;
typedef int (*Op)(int, int);
typedef char Name[16];
/* typedef int Commented; */
int typedef_count;
`)
      ).sort()
    ).toEqual(['Name', 'Node', 'Op', 'Point', 'intptr', 'myint']);
  });
});

describe('a pointer declared with a typedef name inside a function', () => {
  it('builds and walks a linked list', async () => {
    const output = await outputOf(`#include <stdio.h>
#include <stdlib.h>
typedef struct node { int v; struct node *next; } Node;
int main(void) {
  Node *head = NULL, *tail = NULL;
  for (int i = 1; i <= 3; i++) {
    Node *n = malloc(sizeof(Node));
    n->v = i;
    n->next = NULL;
    if (tail == NULL) { head = n; } else { tail->next = n; }
    tail = n;
  }
  int sum = 0;
  for (Node *p = head; p != NULL; p = p->next) sum += p->v;
  printf("%d\\n", sum);
  return 0;
}
`);
    expect(output).toBe('6\n');
  });

  it('declares the pointer the canvas draws', async () => {
    const run = await exec(`#include <stddef.h>
typedef int myint;
int main(void) {
  myint a = 4;
  myint *q = &a;
  myint **qq = &q;
  size_t n = 3;
  size_t *p = &n;
  *q = 9;
  return 0;
}
`);
    expect(run.response.errors).toEqual([]);
    expect(typeOf(run.model, 'q')).toBe('myint *');
    expect(targetOf(run.model, 'q')).toBe('a');
    expect(targetOf(run.model, 'qq')).toBe('q');
    expect(targetOf(run.model, 'p')).toBe('n');
  });

  it('leaves a real multiplication alone', async () => {
    expect(
      await outputOf(`#include <stdio.h>
typedef int myint;
int main(void) {
  int a = 6, b = 7;
  int c = a * b;
  a * b;
  printf("%d\\n", c);
  return 0;
}
`)
    ).toBe('42\n');
  });
});

describe('a cast to a typedef name', () => {
  it('passes the syntax check', () => {
    const code = `typedef int myint;
int main(void) { int x = 7; myint y = (myint)x; return y; }
`;
    expect(jscppCheck(code).error).toBeNull();
    expect(new PlivetCPP14Interpreter().checkSyntaxError(code)).toEqual([]);
  });

  it('casts a negated, dereferenced or address operand', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stddef.h>
typedef int myint;
typedef unsigned char byte;
int main(void) {
  int x = 7;
  int *p = &x;
  myint y = (myint)x;
  long d = (ptrdiff_t)-2 * 3;
  myint z = (myint)*p + 1;
  byte b = (byte)-1;
  printf("%d %ld %d %d\\n", y, d, z, b);
  return 0;
}
`)
    ).toBe('7 -6 8 255\n');
  });
});
