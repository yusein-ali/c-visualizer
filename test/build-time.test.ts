import { buildTimeLiteral } from '../src/interpreter/preprocess';
import { outputOf } from './library';

describe('__DATE__ and __TIME__', () => {
  it('spell the date and the time as a compiler does', () => {
    const when = new Date(2026, 10, 5, 9, 7, 3);
    expect(buildTimeLiteral('__DATE__', when)).toBe('"Nov  5 2026"');
    expect(buildTimeLiteral('__TIME__', when)).toBe('"09:07:03"');
  });

  it('expand in a program to string literals of those shapes', async () => {
    const output = await outputOf(`#include <stdio.h>
int main(void) {
  printf("[%s] [%s] %d\\n", __DATE__, __TIME__, __LINE__);
  return 0;
}`);
    expect(output).toMatch(
      /^\[[A-Z][a-z]{2} [ \d]\d \d{4}\] \[\d{2}:\d{2}:\d{2}\] 3\n$/
    );
  });
});
