import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, valueOf } from './library';

/**
 * A library function used as a value: `size_t (*f)(const char *) = strlen;`.
 * A program's own function has an address on the code segment; a library
 * function had none, so the lint took `strlen` for an undeclared object and
 * the program never started.
 */

const program = (body: string, globals = ''): string => `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
${globals}
int main(void) {
${body}
  return 0;
}`;

describe('a library function used as a value', () => {
  it('is called through a pointer it initializes', async () => {
    expect(
      await outputOf(
        program(`  size_t (*f)(const char *) = strlen;
  printf("%d\\n", (int)f("abc"));`)
      )
    ).toBe('3\n');
  });

  it('is called through a pointer it is assigned to, in both spellings', async () => {
    expect(
      await outputOf(
        program(`  int (*say)(const char *);
  say = puts;
  say("one");
  (*say)("two");
  int (*cmp)(const char *, const char *) = &strcmp;
  printf("%d %d\\n", cmp("a", "a"), cmp("a", "b") < 0);`)
      )
    ).toBe('one\ntwo\n0 1\n');
  });

  it('is passed to a function that calls it', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d\\n", apply(strlen, "four"), apply(length, "four"));`,
          `size_t length(const char *s) { return strlen(s) * 2; }
int apply(size_t (*f)(const char *), const char *s) { return (int)f(s); }`
        )
      )
    ).toBe('4 8\n');
  });

  it('compares equal to itself and unequal to another function', async () => {
    expect(
      await outputOf(
        program(`  size_t (*f)(const char *) = strlen;
  int (*g)(const char *) = puts;
  printf("%d %d %d\\n", f == strlen, f != NULL, (void *)g == (void *)f);`)
      )
    ).toBe('1 1 0\n');
  });

  it('is named on the canvas', async () => {
    const run = await exec(
      program(`  size_t (*f)(const char *) = strlen;
  printf("%d\\n", (int)f("ab"));`)
    );
    expect(run.output).toBe('2\n');
    expect(valueOf(run.model, 'f')).toMatch(/strlen/);
  });

  it('is not reported as an undeclared name', () => {
    const interpreter = new PlivetCPP14Interpreter();
    const lints = interpreter.getLinkerLints(
      program(`  size_t (*f)(const char *) = strlen;
  int (*g)(const char *) = puts;
  printf("%d\\n", (int)f("ab") + g("x"));`)
    );
    expect(
      lints.filter((lint) => lint.rule === 'undeclared-identifier')
    ).toEqual([]);
  });

  it('still reports a name nothing declares', () => {
    const interpreter = new PlivetCPP14Interpreter();
    const lints = interpreter.getLinkerLints(
      program(`  size_t (*f)(const char *) = strlenn;
  printf("%d\\n", (int)f("ab"));`)
    );
    expect(lints.map((lint) => lint.rule)).toContain('undeclared-identifier');
  });
});
