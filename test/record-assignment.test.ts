import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

/**
 * Assigning one struct or union to another.
 *
 * The inherited engine copies each member's stored word, which is right for a
 * scalar and wrong for a member that is itself a record: the word held there
 * is the address of that member's own block, so the copy left both records
 * sharing one nested object. It also wrote every member directly, so a `const`
 * member was no obstacle. `PlivetCPP14Engine.copyRecord` replaces that walk.
 *
 * A refused assignment ends the run where it stands, with the reason written
 * to the console (`runtime-refusal.test.ts` covers what it says), so the cases
 * that must not copy are written as programs whose `printf` is never reached.
 */
const execute = (code: string): { output: string; states: ExecState[] } => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  const states: ExecState[] = [];
  try {
    states.push(interpreter.startStepExecution(code));
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      states.push(interpreter.stepExecute());
      steps += 1;
    }
    return { output: interpreter.getStdout(), states };
  } finally {
    console.log = log;
  }
};
const run = (code: string): string => execute(code).output;

describe('assigning a record', () => {
  it('copies a flat struct into the storage the destination already has', () => {
    expect(
      run(`#include <stdio.h>
struct Point { int x; int y; };
int main(){
  struct Point a; a.x = 1; a.y = 2;
  struct Point b; b.x = 9; b.y = 9;
  b = a;
  a.x = 100;
  printf("%d %d\\n", b.x, b.y);
  return 0;
}`)
    ).toBe('1 2\n');
  });

  it('copies a record-valued member instead of sharing it', () => {
    expect(
      run(`#include <stdio.h>
struct Inner { int v; };
struct Outer { struct Inner in; int t; };
int main(){
  struct Outer a; a.in.v = 1; a.t = 2;
  struct Outer b; b.in.v = 9; b.t = 9;
  b = a;
  a.in.v = 100;
  printf("%d %d\\n", b.in.v, b.t);
  return 0;
}`)
    ).toBe('1 2\n');
  });

  it('copies through every level of nesting', () => {
    expect(
      run(`#include <stdio.h>
struct A { int v; };
struct B { struct A a; };
struct C { struct B b; int t; };
int main(){
  struct C x; x.b.a.v = 1; x.t = 2;
  struct C y; y = x;
  x.b.a.v = 100;
  printf("%d %d\\n", y.b.a.v, y.t);
  return 0;
}`)
    ).toBe('1 2\n');
  });

  it('assigns a member that is itself a record', () => {
    expect(
      run(`#include <stdio.h>
struct Inner { int v; };
struct Outer { struct Inner in; };
int main(){
  struct Outer a; a.in.v = 1;
  struct Outer b; b.in.v = 9;
  b.in = a.in;
  a.in.v = 100;
  printf("%d\\n", b.in.v);
  return 0;
}`)
    ).toBe('1\n');
  });

  it('copies a union', () => {
    expect(
      run(`#include <stdio.h>
union Value { int i; char c; };
int main(){
  union Value a; a.i = 65;
  union Value b; b.i = 0;
  b = a;
  a.i = 7;
  printf("%d %c\\n", b.i, b.c);
  return 0;
}`)
    ).toBe('65 A\n');
  });

  it('copies a pointer member as the address it holds', () => {
    // A shallow copy is what C means here: both records point at one `n`.
    expect(
      run(`#include <stdio.h>
struct Ref { int* p; int v; };
int main(){
  int n = 5;
  struct Ref a; a.p = &n; a.v = 1;
  struct Ref b; b = a;
  *b.p = 9;
  printf("%d %d\\n", n, b.v);
  return 0;
}`)
    ).toBe('9 1\n');
  });

  it('assigns through a pointer, into an array element and onto the heap', () => {
    expect(
      run(`#include <stdio.h>
#include <stdlib.h>
struct Point { int x; int y; };
int main(){
  struct Point a; a.x = 1; a.y = 2;
  struct Point b; struct Point* q = &b; *q = a;
  struct Point points[2]; points[0].x = 3; points[0].y = 4; points[1] = points[0];
  struct Point* heap = (struct Point*)malloc(sizeof(struct Point)); *heap = a;
  a.x = 100; points[0].x = 100;
  printf("%d %d %d %d %d\\n", b.x, b.y, points[1].x, points[1].y, heap->x);
  return 0;
}`)
    ).toBe('1 2 3 4 1\n');
  });

  it('leaves an object unchanged when it assigns to itself', () => {
    expect(
      run(`#include <stdio.h>
struct Point { int x; int y; };
int main(){
  struct Point a; a.x = 1; a.y = 2;
  a = a;
  printf("%d %d\\n", a.x, a.y);
  return 0;
}`)
    ).toBe('1 2\n');
  });

  it('copies a record passed to and returned from a function', () => {
    expect(
      run(`#include <stdio.h>
struct Inner { int v; };
struct Outer { struct Inner in; };
struct Outer make(int v){ struct Outer o; o.in.v = v; return o; }
void bump(struct Outer o){ o.in.v = 999; }
int main(){
  struct Outer a = make(3);
  bump(a);
  printf("%d\\n", a.in.v);
  return 0;
}`)
    ).toBe('3\n');
  });

  it('refuses to assign a record that holds a const member', () => {
    // C rejects the whole assignment, not just the const member, so neither
    // member moves and the program stops at the assignment.
    const direct = execute(`#include <stdio.h>
struct Sample { const int id; int value; };
int main(){
  struct Sample a = {1, 2};
  struct Sample b = {3, 4};
  b = a;
  printf("%d %d\\n", b.id, b.value);
  return 0;
}`);
    expect(direct.output).toContain(
      'const-qualified structure or union member id'
    );
    expect(direct.output).not.toContain('1 2');
    expect(memberValues(direct.states, 'b')).toEqual([3, 4]);

    const nested = execute(`#include <stdio.h>
struct Reading { const int raw; };
struct Sensor { struct Reading reading; int scale; };
int main(){
  struct Sensor a; a.scale = 1;
  struct Sensor b; b.scale = 2;
  b = a;
  printf("%d\\n", b.scale);
  return 0;
}`);
    expect(nested.output).toContain(
      'const-qualified structure or union member reading.raw'
    );
    expect(memberValues(nested.states, 'b')).toEqual([2]);
  });

  it('still refuses to assign to a const record', () => {
    const result = execute(`#include <stdio.h>
struct Point { int x; };
int main(){
  struct Point a; a.x = 1;
  const struct Point b = a;
  struct Point c; c.x = 2;
  b = c;
  printf("%d\\n", b.x);
  return 0;
}`);
    expect(result.output).toContain('const-qualified object');
    expect(memberValues(result.states, 'b')).toEqual([1]);
  });
});

/** The scalar members of `name`, as the last state to hold it saw them. */
function memberValues(states: ExecState[], name: string): number[] {
  const values: number[] = [];
  const collect = (variable: any): void => {
    const value = variable.getValue();
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (value !== null && typeof value !== 'undefined') {
      values.push(Number(value.valueOf()));
    }
  };
  for (const state of states.slice().reverse()) {
    for (const stack of state.getStacks()) {
      const found = stack
        .getVariables()
        .find((variable: any) => variable.getName() === name);
      if (typeof found !== 'undefined') {
        collect(found);
        return values;
      }
    }
  }
  return values;
}
