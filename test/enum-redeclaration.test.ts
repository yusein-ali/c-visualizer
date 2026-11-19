import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec } from './library';

/**
 * An enumeration constant is an identifier of its scope, and one scope
 * declares an identifier once: gcc refuses `enum a { RED, GREEN }; enum b {
 * GREEN2, RED };`. The interpreter ran it, with RED the later one.
 */

const errorsOf = (code: string) =>
  new PlivetCPP14Interpreter().checkSyntaxError(code);

describe('an enumeration constant declared twice', () => {
  const twice = `#include <stdio.h>
enum a { RED, GREEN }; enum b { GREEN2, RED }; int main(void) { printf("%d\\n", RED); return 0; }`;

  it('is refused where the second declaration is', () => {
    const errors = errorsOf(twice);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(errors[0].charPositionInLine).toBe(40);
    expect(errors[0].msg).toMatch(/redeclaration of enumerator RED/);
  });

  it('does not run', async () => {
    const run = await exec(twice);
    expect(run.output).toBe('');
    expect(run.response.errors).toHaveLength(1);
  });

  it('is refused in one enumeration and in one block too', () => {
    expect(
      errorsOf('enum e { A, B, A };\nint main(void) { return 0; }')
    ).toHaveLength(1);
    expect(
      errorsOf(`int main(void) {
  enum one { X };
  enum two { X };
  return 0;
}`)
    ).toHaveLength(1);
  });

  it('is accepted in different blocks', () => {
    expect(
      errorsOf(`int f(void) { enum { LOW = 1 } level = LOW; return level; }
int main(void) {
  enum { LOW = 5 } level = LOW;
  return level + f();
}`)
    ).toEqual([]);
  });
});
