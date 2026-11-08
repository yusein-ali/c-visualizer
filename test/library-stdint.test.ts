import { libraryHelp } from '../src/app/libraryHelp';
import { narrowToType } from '../src/core';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, typeOf, valueOf } from './library';

/**
 * `<stdint.h>`: the exact-width types of 8, 16 and 32 bits, `intptr_t`,
 * `uintptr_t`, and their limits.
 *
 * The names used to be accepted with no width at all: a `uint8_t` holding
 * 250, plus 10, held 260, and a `uint32_t` holding 0, minus 1, held -1. The
 * engine is now given each as a typedef (`library/types.ts`), so a value
 * wraps at the type's width, `sizeof` says it, and an array's elements and a
 * pointer's steps are that many bytes apart.
 */

describe('the exact-width types', () => {
  it('wrap at their width, as C converts to them', async () => {
    const run = await exec(`#include <stdio.h>
#include <stdint.h>
int main(void) {
  uint8_t b = 250;
  b += 10;
  uint16_t w = 65535;
  w = w + 1;
  uint32_t u = 0;
  u = u - 1;
  int8_t s = 127;
  s++;
  int16_t h = (int16_t)40000;
  int32_t i = (int32_t)u;
  printf("%d %d %u %d %d %d\\n", b, w, u, s, h, i);
  return 0;
}`);
    expect(run.output).toBe('4 0 4294967295 -128 -25536 -1\n');
    expect(run.runtime.filter((one) => one.fatal)).toEqual([]);
    expect(typeOf(run.model, 'b')).toBe('uint8_t');
    expect(valueOf(run.model, 'b')).toBe('4');
    expect(valueOf(run.model, 'u')).toBe('4294967295');
    expect(valueOf(run.model, 's')).toBe('-128');
  });

  it('have the size of their width, in sizeof, arrays and pointer steps', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
uint8_t bytes[4] = {1, 2, 3, 4};
uint16_t wide = 70000;
int main(void) {
  uint8_t *p = bytes;
  p += 2;
  *p = 99;
  int16_t halves[3] = {1, 2, 3};
  int16_t *q = &halves[1];
  printf("%zu %zu %zu %zu %zu\\n", sizeof(int8_t), sizeof(uint16_t),
         sizeof(int32_t), sizeof bytes, sizeof halves);
  printf("%d %d %d %d %d\\n", (int)(p - bytes), bytes[2], *q,
         (int)(q - halves), wide);
  return 0;
}`)
    ).toBe('1 2 4 4 6\n2 99 2 1 4464\n');
  });

  it('cast, including to a parenthesised operand', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
int main(void) {
  int m = 300;
  uint8_t d = (uint8_t)(-1) + 1;
  printf("%d %d %d %d\\n", (uint8_t)m, (uint8_t)(m), d, (uint16_t)(70000));
  return 0;
}`)
    ).toBe('44 44 0 4464\n');
  });

  it('give way to a typedef the program declares itself', async () => {
    expect(
      await outputOf(`#include <stdio.h>
typedef unsigned short uint8_t;
int main(void) {
  uint8_t b = 300;
  uint8_t pair[2] = {1, 2};
  printf("%d %zu %zu\\n", b, sizeof(uint8_t), sizeof pair);
  return 0;
}`)
    ).toBe('300 2 4\n');
  });

  it('pass the syntax check and are drawn with their own width', () => {
    const code = `#include <stdint.h>
int main(void) {
  uint8_t b = (uint8_t)7;
  int16_t h = (int16_t)(b);
  uintptr_t a = (uintptr_t)&h;
  return (int)a == 0;
}
`;
    expect(new PlivetCPP14Interpreter().checkSyntaxError(code)).toEqual([]);
    expect(narrowToType(260, 'uint8_t')).toBe(4);
    expect(narrowToType(40000, 'int16_t')).toBe(-25536);
    expect(narrowToType(-1, 'uint32_t')).toBe(4294967295);
  });
});

describe('the <stdint.h> limits', () => {
  it('have the values of the types they bound', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <stdint.h>
int main(void) {
  printf("%d %d %d\\n", INT8_MIN, INT8_MAX, UINT8_MAX);
  printf("%d %d %d\\n", INT16_MIN, INT16_MAX, UINT16_MAX);
  printf("%d %d %u\\n", INT32_MIN, INT32_MAX, UINT32_MAX);
  printf("%u %zu %d\\n", UINTPTR_MAX, SIZE_MAX, PTRDIFF_MAX);
  uint8_t top = UINT8_MAX;
  top++;
  printf("%d\\n", top);
  return 0;
}`)
    ).toBe(
      '-128 127 255\n-32768 32767 65535\n' +
        '-2147483648 2147483647 4294967295\n' +
        '4294967295 4294967295 2147483647\n0\n'
    );
  });
});

describe('the editor help', () => {
  it('describes each type and limit under <stdint.h>', () => {
    for (const name of [
      'int8_t',
      'uint8_t',
      'int16_t',
      'uint16_t',
      'int32_t',
      'uint32_t',
      'intptr_t',
      'uintptr_t',
    ]) {
      expect(libraryHelp(name)).toMatchObject({
        header: 'stdint.h',
        kind: 'type',
      });
    }
    expect(libraryHelp('uint8_t')?.signature).toBe(
      'typedef unsigned char uint8_t'
    );
    expect(libraryHelp('UINT32_MAX')).toMatchObject({
      header: 'stdint.h',
      kind: 'macro',
      signature: '#define UINT32_MAX (4294967295U)',
    });
  });
});
