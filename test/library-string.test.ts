import { libraryHelp } from '../src/app/libraryHelp';
import { exec, outputOf, rulesOf, targetOf, valueOf } from './library';

/**
 * `<string.h>`: what each function computes, that what it writes is on the
 * canvas, that a pointer it returns points into its argument, and that what
 * C leaves undefined stops the program on the line that did it.
 */

const program = (body: string): string => `#include <stdio.h>
#include <string.h>
int main(void) {
${body}
  return 0;
}`;

describe('<string.h> bounded copies and comparisons', () => {
  it('strncpy pads with null characters and does not terminate a long source', async () => {
    const run = await exec(
      program(`  char a[8];
  char b[4];
  strncpy(a, "hi", 5);
  strncpy(b, "four", 4);
  printf("%s %d %d %d %c\\n", a, a[2], a[3], a[4], b[3]);`)
    );
    expect(run.output).toBe('hi 0 0 0 r\n');
    expect(valueOf(run.model, 'a[4]')).toMatch(/^0 /);
    // C allows it, but the reader is told the result is not a string.
    expect(rulesOf(run)).toEqual(['unterminated-string']);
    expect(run.runtime[0].fatal).toBe(false);
  });

  it('strncat appends at most n characters and always terminates', async () => {
    expect(
      await outputOf(
        program(`  char s[16] = "abc";
  strncat(s, "defgh", 3);
  strncat(s, "XY", 10);
  printf("%s %d\\n", s, (int)strlen(s));`)
      )
    ).toBe('abcdefXY 8\n');
  });

  it('strcmp and strncmp compare as unsigned char and stop at n', async () => {
    expect(
      await outputOf(
        program(`  printf("%d %d %d\\n", strcmp("abc", "abd") < 0, strcmp("b", "a") > 0, strcmp("same", "same"));
  printf("%d %d\\n", strncmp("apple", "apricot", 2), strncmp("apple", "apricot", 3) < 0);`)
      )
    ).toBe('1 1 0\n0 1\n');
  });

  it('strlen counts characters, not bytes of a wider encoding, and divides as an integer', async () => {
    expect(
      await outputOf(program(`  printf("%d\\n", (int)(strlen("seven") / 2));`))
    ).toBe('2\n');
  });
});

describe('<string.h> searching', () => {
  it('strchr and strrchr return pointers into the array they searched', async () => {
    const run = await exec(
      program(`  char path[] = "a/b/c.txt";
  char *first = strchr(path, '/');
  char *last = strrchr(path, '/');
  char *none = strchr(path, 'z');
  char *end = strchr(path, '\\0');
  printf("%d %d %d %d %s\\n", (int)(first - path), (int)(last - path), none == NULL, (int)(end - path), last + 1);`)
    );
    expect(run.output).toBe('1 3 1 9 c.txt\n');
    expect(targetOf(run.model, 'first')).toBe('path[1]');
    expect(targetOf(run.model, 'last')).toBe('path[3]');
  });

  it('strstr finds a substring, and an empty one at the start', async () => {
    expect(
      await outputOf(
        program(`  const char *text = "needle in a haystack";
  printf("%s|%s|%d\\n", strstr(text, "hay"), strstr(text, ""), strstr(text, "pin") == NULL);`)
      )
    ).toBe('haystack|needle in a haystack|1\n');
  });

  it('a pointer into a string literal points into read-only memory', async () => {
    const run = await exec(
      program(`  char *p = strchr("hello", 'l');
  printf("%s\\n", p);`)
    );
    expect(run.output).toBe('llo\n');
    expect(run.runtime).toEqual([]);
    expect(valueOf(run.model, 'p')).toMatch(/^0x/);
  });

  it('strspn, strcspn and strpbrk measure and find by character set', async () => {
    expect(
      await outputOf(
        program(
          `  printf("%d %d %s\\n", (int)strspn("2024-11-07", "0123456789"), (int)strcspn("key=value", "=;"), strpbrk("a, b; c", ";,"));`
        )
      )
    ).toBe('4 3 , b; c\n');
  });

  it('strtok splits in place, one token per call, and keeps its place between calls', async () => {
    const run = await exec(
      program(`  char line[] = " red,green,,blue ";
  char *token = strtok(line, " ,");
  while (token != NULL) {
    printf("[%s]", token);
    token = strtok(NULL, " ,");
  }
  printf("\\n");`)
    );
    expect(run.output).toBe('[red][green][blue]\n');
    // The delimiters it consumed are null characters now, on the canvas too.
    expect(valueOf(run.model, 'line[4]')).toMatch(/^0 /);
  });

  it('strtok refuses a string literal, which it would have to modify', async () => {
    const run = await exec(program(`  strtok("a,b", ",");`));
    expect(rulesOf(run)).toEqual(['string-literal-modification']);
  });
});

describe('<string.h> memory blocks', () => {
  it('memset writes bytes, so an int holds four of them', async () => {
    const run = await exec(
      program(`  int counts[3];
  memset(counts, 0, sizeof(counts));
  int ones[2];
  memset(ones, 1, sizeof(ones));
  printf("%d %d %d\\n", counts[0], counts[2], ones[1]);`)
    );
    expect(run.output).toBe('0 0 16843009\n');
    expect(valueOf(run.model, 'counts[1]')).toBe('0');
    expect(valueOf(run.model, 'ones[0]')).toBe('16843009');
    // Written by memset, so nothing reads as uninitialised afterwards.
    expect(rulesOf(run)).toEqual([]);
  });

  it('memcpy copies ints and doubles byte for byte', async () => {
    const run = await exec(
      program(`  int from[3] = {7, -1, 300};
  int to[3] = {0, 0, 0};
  double d = 2.5, e = 0.0;
  memcpy(to, from, sizeof(from));
  memcpy(&e, &d, sizeof(double));
  printf("%d %d %d %.1f\\n", to[0], to[1], to[2], e);`)
    );
    expect(run.output).toBe('7 -1 300 2.5\n');
    expect(valueOf(run.model, 'to[2]')).toBe('300');
  });

  it('memmove copies between overlapping bytes', async () => {
    expect(
      await outputOf(
        program(`  char s[] = "abcdef";
  memmove(s + 2, s, 4);
  printf("%s\\n", s);`)
      )
    ).toBe('ababcd\n');
  });

  it('memcpy between overlapping bytes is a diagnostic that names memmove', async () => {
    const run = await exec(
      program(`  char s[] = "abcdef";
  memcpy(s + 1, s, 3);`)
    );
    expect(rulesOf(run)).toEqual(['overlapping-copy']);
    expect(run.runtime[0].line).toBe(5);
    expect(run.runtime[0].message).toContain('memmove');
  });

  it('memcmp compares bytes as unsigned char; memchr finds one', async () => {
    expect(
      await outputOf(
        program(`  unsigned char a[3] = {1, 2, 200};
  unsigned char b[3] = {1, 2, 3};
  char text[] = "find me";
  char *m = memchr(text, 'm', sizeof(text));
  printf("%d %d %d %s %d\\n", memcmp(a, b, 2), memcmp(a, b, 3) > 0, memcmp(b, a, 3) < 0, m, memchr(text, 'z', 4) == NULL);`)
      )
    ).toBe('0 1 1 me 1\n');
  });

  it('copies, clears and compares whole structures member by member', async () => {
    const run = await exec(`#include <stdio.h>
#include <string.h>
struct Point { int x; double y; char tag; };
int main(void) {
  struct Point a = {3, 1.5, 'a'};
  struct Point b;
  memcpy(&b, &a, sizeof(struct Point));
  printf("%d %.1f %c %d\\n", b.x, b.y, b.tag, memcmp(&a, &b, sizeof a));
  memset(&a, 0, sizeof a);
  printf("%d %.1f %d\\n", a.x, a.y, a.tag);
  return 0;
}`);
    expect(run.output).toBe('3 1.5 a 0\n0 0.0 0\n');
    expect(rulesOf(run)).toEqual([]);
  });
});

describe('<string.h> refuses what C leaves undefined', () => {
  it('strcpy past the end of the destination', async () => {
    const run = await exec(
      program(`  char small[4];
  strcpy(small, "too long");`)
    );
    expect(rulesOf(run)).toEqual(['buffer-overflow']);
    expect(run.runtime[0].line).toBe(5);
    expect(run.runtime[0].message).toContain('small');
    expect(run.output).toContain('c-visualizer stopped the program on line 5');
  });

  it('strcat past the end, counting what is already there', async () => {
    const run = await exec(
      program(`  char s[8] = "abcd";
  strcat(s, "efgh");`)
    );
    expect(rulesOf(run)).toEqual(['buffer-overflow']);
  });

  it('memset past the end of a block from malloc', async () => {
    const run = await exec(`#include <stdlib.h>
#include <string.h>
int main(void) {
  char *p = malloc(4);
  memset(p, 0, 5);
  return 0;
}`);
    expect(rulesOf(run)).toEqual(['buffer-overflow']);
  });

  it('a string with no terminator inside its array', async () => {
    const run = await exec(
      program(`  char letters[3] = {'a', 'b', 'c'};
  printf("%d\\n", (int)strlen(letters));`)
    );
    expect(rulesOf(run)).toEqual(['unterminated-string']);
  });

  it('a null pointer argument', async () => {
    const run = await exec(
      program(`  char *nothing = NULL;
  printf("%d\\n", (int)strlen(nothing));`)
    );
    expect(rulesOf(run)).toEqual(['null-pointer-argument']);
  });

  it('a write into a const array', async () => {
    const run = await exec(
      program(`  const char fixed[8] = "abc";
  strcpy((char *)fixed, "xyz");`)
    );
    expect(rulesOf(run)).toEqual(['read-only-assignment']);
  });

  it('stops a refusal inside a called function too', async () => {
    const run = await exec(`#include <stdio.h>
#include <string.h>
void fill(char *to) {
  strcpy(to, "overflowing");
}
int main(void) {
  char buf[4];
  fill(buf);
  printf("still running\\n");
  return 0;
}`);
    expect(rulesOf(run)).toEqual(['buffer-overflow']);
    expect(run.output).not.toContain('still running');
  });
});

describe('the mutation view', () => {
  it('records what a library call stored, once per object', async () => {
    const run = await exec(
      program(`  char name[6] = "ab";
  int counts[2] = {5, 6};
  strcpy(name, "xyz");
  memset(counts, 0, sizeof(counts));`)
    );
    const library = run.model.mutations.filter(
      (one) => one.line === 6 || one.line === 7
    );
    expect(library).toEqual([
      {
        target: 'name',
        frame: 'main',
        before: '"ab\\0\\0"',
        after: '"xyz\\0"',
        line: 6,
      },
      {
        target: 'counts',
        frame: 'main',
        before: '{5, 6}',
        after: '{0, 0}',
        line: 7,
      },
    ]);
  });
});

describe('strerror', () => {
  it('uses the glibc wording', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <string.h>
#include <errno.h>
int main(void) {
  printf("%s|%s|%s|%s|%s|%s\\n", strerror(0), strerror(EDOM), strerror(ERANGE), strerror(EINVAL), strerror(ENOENT), strerror(999));
  return 0;
}`)
    ).toBe(
      'Success|Numerical argument out of domain|Numerical result out of range|Invalid argument|No such file or directory|Unknown error 999\n'
    );
  });
});

it('documents every <string.h> function', () => {
  for (const name of [
    'strncpy',
    'strncat',
    'strncmp',
    'strchr',
    'strrchr',
    'strstr',
    'strtok',
    'strspn',
    'strcspn',
    'strpbrk',
    'memcpy',
    'memmove',
    'memset',
    'memcmp',
    'memchr',
    'strerror',
  ]) {
    expect(libraryHelp(name)).toMatchObject({ header: 'string.h' });
  }
});
