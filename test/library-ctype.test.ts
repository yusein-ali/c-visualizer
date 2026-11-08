import { libraryHelp } from '../src/app/libraryHelp';
import { exec, outputOf, rulesOf } from './library';

/**
 * `<ctype.h>` in the "C" locale: every classification over every value an
 * `unsigned char` holds, plus EOF, checked against the table C11 7.4 gives,
 * and the diagnostic for an argument C leaves undefined.
 */

const CLASSES: Record<string, (c: number) => boolean> = {
  isalpha: (c) => /[A-Za-z]/.test(String.fromCharCode(c)) && c < 128,
  isdigit: (c) => 48 <= c && c <= 57,
  isalnum: (c) => /[A-Za-z0-9]/.test(String.fromCharCode(c)) && c < 128,
  isspace: (c) => c === 32 || (9 <= c && c <= 13),
  isupper: (c) => 65 <= c && c <= 90,
  islower: (c) => 97 <= c && c <= 122,
  ispunct: (c) =>
    33 <= c && c <= 126 && !/[A-Za-z0-9]/.test(String.fromCharCode(c)),
  isprint: (c) => 32 <= c && c <= 126,
  isgraph: (c) => 33 <= c && c <= 126,
  iscntrl: (c) => c < 32 || c === 127,
  isxdigit: (c) => /[0-9A-Fa-f]/.test(String.fromCharCode(c)) && c < 128,
  isblank: (c) => c === 32 || c === 9,
};

describe('<ctype.h>', () => {
  it.each(Object.keys(CLASSES))(
    '%s classifies EOF and every unsigned char as the C locale does',
    async (name) => {
      const output = await outputOf(`#include <ctype.h>
#include <stdio.h>
int main(void) {
  printf("%d,", ${name}(-1) != 0);
  for (int c = 0; c < 256; c++) {
    printf("%d", ${name}(c) != 0);
  }
  return 0;
}`);
      const expected =
        '0,' +
        Array.from({ length: 256 }, (_, c) =>
          CLASSES[name](c) ? '1' : '0'
        ).join('');
      expect(output).toBe(expected);
    },
    20000
  );

  it('returns the bit glibc returns rather than 1', async () => {
    const output = await outputOf(`#include <ctype.h>
#include <stdio.h>
int main(void) {
  printf("%d %d %d %d\\n", isdigit('7'), isalpha('q'), isspace(' '), isdigit('x'));
  return 0;
}`);
    expect(output).toBe('2048 1024 8192 0\n');
  });

  it('converts case and leaves everything else, EOF included, alone', async () => {
    const output = await outputOf(`#include <ctype.h>
#include <stdio.h>
int main(void) {
  char word[] = "Hello, World 42";
  for (int i = 0; word[i] != '\\0'; i++) {
    word[i] = toupper(word[i]);
  }
  printf("%s %c %d %d\\n", word, tolower('Q'), toupper(-1), tolower('{'));
  return 0;
}`);
    expect(output).toBe('HELLO, WORLD 42 q -1 123\n');
  });

  it('counts with isalpha and isdigit in an ordinary loop', async () => {
    const output = await outputOf(`#include <ctype.h>
#include <stdio.h>
int main(void) {
  const char *text = "a1 b22 c333!";
  int letters = 0, digits = 0, spaces = 0, other = 0;
  for (int i = 0; text[i] != '\\0'; i++) {
    if (isalpha(text[i])) letters++;
    else if (isdigit(text[i])) digits++;
    else if (isspace(text[i])) spaces++;
    else other++;
  }
  printf("%d %d %d %d\\n", letters, digits, spaces, other);
  return 0;
}`);
    expect(output).toBe('3 6 2 1\n');
  });

  it('stops on an argument that is neither EOF nor an unsigned char', async () => {
    const run = await exec(`#include <ctype.h>
int main(void) {
  int c = -42;
  return isalpha(c);
}`);
    expect(rulesOf(run)).toEqual(['ctype-argument']);
    expect(run.runtime[0].fatal).toBe(true);
    expect(run.runtime[0].line).toBe(4);
    expect(run.runtime[0].message).toContain('-42');
    expect(run.runtime[0].message).toContain('(unsigned char)');
  });

  it('documents every function for completion and hover', () => {
    for (const name of Object.keys(CLASSES).concat(['toupper', 'tolower'])) {
      expect(libraryHelp(name)).toMatchObject({ header: 'ctype.h' });
    }
  });
});
