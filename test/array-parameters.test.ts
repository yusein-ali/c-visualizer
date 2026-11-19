import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { displayTypeOf } from '../src/interpreter/RuntimeTypeInfo';
import { exec, outputOf, typeOf } from './library';

/**
 * A parameter declared as an array of arrays is a pointer to its first row
 * (C11 6.7.6.3p7): `int log[][3]`, `int log[2][3]` and `int (*log)[3]` are
 * one type. The engine bound the first two as an `int` and could not parse
 * the third at all.
 */

const program = (body: string, globals: string): string => `#include <stdio.h>
${globals}
int main(void) {
  int log[2][3] = {{1, 2, 3}, {4, 5, 6}};
${body}
  return 0;
}`;

describe('a two-dimensional array parameter', () => {
  it.each([
    ['int log[][3]'],
    ['int log[2][3]'],
    ['int (*log)[3]'],
    ['int (* log) [3]'],
  ])('reads the rows of %s', async (parameter) => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d\\n", row_sum(log, 1), row_sum(log, 0));`,
          `int row_sum(${parameter}, int r) {
  int t = 0;
  for (int d = 0; d < 3; d++) t += log[r][d];
  return t;
}`
        )
      )
    ).toBe('15 6\n');
  });

  it('writes through the parameter into the caller array', async () => {
    expect(
      await outputOf(
        program(
          `  fill(log, 2, 7);
  printf("%d %d %d\\n", log[0][0], log[1][2], log[1][1]);`,
          `void fill(int grid[][3], int rows, int value) {
  for (int r = 0; r < rows; r++) {
    for (int c = 0; c < 3; c++) {
      grid[r][c] = value + r * 3 + c;
    }
  }
}`
        )
      )
    ).toBe('7 12 11\n');
  });

  it('reads a row through a pointer to it', async () => {
    const run = await exec(
      program(
        `  printf("%d\\n", first(log));`,
        `int first(int (*rows)[3]) {
  int value = rows[1][0];
  return value;
}`
      )
    );
    expect(run.output).toBe('4\n');
  });

  it('leaves the array it was given an array of arrays', async () => {
    const run = await exec(
      program(
        `  printf("%d\\n", peek(log));`,
        `int peek(int rows[][3]) {
  int value = rows[1][2];
  while (value > 100) {
    value--;
  }
  return value;
}`
      )
    );
    expect(run.output).toBe('6\n');
    expect(typeOf(run.model, 'log')).toBe('int[2][3]');
  });

  it('is spelled as C spells a pointer to an array', () => {
    expect(displayTypeOf(new Variable('int[3]*', 'rows', 0, 0, 0))).toBe(
      'int (*)[3]'
    );
    expect(displayTypeOf(new Variable('int*', 'p', 0, 0, 0))).toBe('int*');
  });
});
