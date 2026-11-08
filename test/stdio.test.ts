import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { RuntimeDiagnostic } from '../src/interpreter/RuntimeDiagnostic';
import {
  countStoredBy,
  directivesOf,
  explainDirective,
  FormatDirective,
  formatPrintf,
  parseFormat,
} from '../src/interpreter/printf';
import { scanReturnValue, scanString } from '../src/interpreter/scanf';
import { scanAll } from '../src/stdio';

/**
 * `printf`, `sprintf`, `snprintf` and `sscanf`: the formatter and matcher on
 * their own, and the engine functions built on them. The parity table in
 * `stdio-parity.test.ts` covers what each conversion prints; this file covers
 * what the table cannot - memory, return values and diagnostics.
 */

interface Session {
  output: string;
  diagnostics: RuntimeDiagnostic[];
}

const run = (code: string): Session => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined;
  try {
    interpreter.startStepExecution(code);
    let steps = 0;
    while (
      interpreter.isStepExecutionRunning() &&
      !interpreter.getIsWaitingForStdin() &&
      steps < 20000
    ) {
      interpreter.stepExecute();
      steps += 1;
    }
    return {
      output: interpreter.getStdout(),
      diagnostics: interpreter.getRuntimeDiagnostics(),
    };
  } finally {
    console.log = log;
  }
};

const directive = (source: string): FormatDirective =>
  directivesOf(parseFormat(source))[0];

describe('parseFormat', () => {
  it('splits a format into literal runs and directives with their offsets', () => {
    const segments = parseFormat('x=%-08.3lf%%!');
    expect(segments.map((one) => [one.kind, one.start, one.end])).toEqual([
      ['literal', 0, 2],
      ['directive', 2, 10],
      ['directive', 10, 12],
      ['literal', 12, 13],
    ]);
    expect(segments[1]).toMatchObject({
      source: '%-08.3lf',
      flags: {
        minus: true,
        zero: true,
        plus: false,
        space: false,
        hash: false,
      },
      width: 8,
      precision: 3,
      length: 'l',
      conversion: 'f',
    });
    expect(segments[1]).not.toHaveProperty('problem');
  });

  it('reads * for the width and the precision', () => {
    expect(directive('%*.*d')).toMatchObject({ width: '*', precision: '*' });
  });

  it('reads a bare . as precision zero', () => {
    expect(directive('%.f').precision).toBe(0);
  });

  it('marks a conversion C does not define, and a format that ends inside one', () => {
    expect(directive('%q').problem).toMatchObject({
      rule: 'unknown-conversion',
      severity: 'error',
    });
    expect(directive('%-5').problem).toMatchObject({
      rule: 'unknown-conversion',
      severity: 'error',
    });
    expect(directive('%2$d').problem?.message).toContain('POSIX');
  });

  it('warns about a length modifier that does not apply', () => {
    expect(directive('%hf').problem).toMatchObject({
      rule: 'invalid-length-modifier',
      severity: 'warning',
    });
    expect(directive('%lf').problem).toBeUndefined();
  });
});

describe('formatPrintf', () => {
  it('says which argument each directive consumed and where its text went', () => {
    const result = formatPrintf('[%*d] %s', [
      { kind: 'int', value: 4 },
      { kind: 'int', value: 7 },
      { kind: 'string', value: 'ok' },
      { kind: 'int', value: 9 },
    ]);
    expect(result.text).toBe('[   7] ok');
    expect(
      result.directives.map((one) => [
        one.widthArgument,
        one.argument,
        one.offset,
        one.text,
      ])
    ).toEqual([
      [0, 1, 1, '   7'],
      [null, 2, 7, 'ok'],
    ]);
    expect(result.unusedArguments).toBe(1);
  });

  it('writes nothing for a missing argument and keeps going', () => {
    const result = formatPrintf('%d,%d,%s', [{ kind: 'int', value: 1 }]);
    expect(result.text).toBe('1,,');
    expect(result.diagnostics.map((one) => one.rule)).toEqual([
      'missing-argument',
      'missing-argument',
    ]);
  });

  it('refuses a string where a number was asked for, and the reverse', () => {
    const number = formatPrintf('%d', [{ kind: 'string', value: '12' }]);
    expect(number.text).toBe('');
    expect(number.diagnostics[0]).toMatchObject({
      rule: 'argument-mismatch',
      severity: 'error',
    });
    const text = formatPrintf('%s', [{ kind: 'char', value: 'A' }]);
    expect(text.text).toBe('');
    expect(text.diagnostics[0].severity).toBe('error');
  });

  it('formats an int given to %f but says the call is undefined', () => {
    const result = formatPrintf('%.1f', [{ kind: 'int', value: 3 }]);
    expect(result.text).toBe('3.0');
    expect(result.diagnostics[0]).toMatchObject({
      rule: 'argument-mismatch',
      severity: 'warning',
    });
  });

  it('says when the argument is wider than the conversion reads', () => {
    const result = formatPrintf('%d', [
      { kind: 'int', value: '4294967297', bits: 64 },
    ]);
    expect(result.text).toBe('1');
    expect(result.diagnostics[0].message).toContain('64 bits');
    // A char or a short is promoted to int, which is what %d reads.
    expect(
      formatPrintf('%d', [{ kind: 'int', value: 7, bits: 8 }]).diagnostics
    ).toEqual([]);
  });

  it('names the caller in its messages', () => {
    const result = formatPrintf('%d', [], { caller: 'sprintf' });
    expect(result.diagnostics[0].message).toContain('sprintf');
  });

  it('refuses a width it would have to allocate', () => {
    const result = formatPrintf('%99999d|', [{ kind: 'int', value: 1 }]);
    expect(result.text).toBe('|');
    expect(result.diagnostics[0].rule).toBe('field-too-wide');
  });

  it('reports the count %n would store, wrapped to its type', () => {
    const result = formatPrintf('abc%hhn', [{ kind: 'pointer', value: 1 }]);
    expect(result.directives[0].offset).toBe(3);
    expect(countStoredBy(directive('%hhn'), 300)).toBe(44);
    expect(countStoredBy(directive('%n'), 300)).toBe(300);
  });
});

describe('explainDirective', () => {
  it('reads a directive back in plain English', () => {
    const text = explainDirective(directive('%-08.3lf'));
    expect(text).toContain('fixed-point');
    expect(text).toContain('at least 8 characters wide');
    expect(text).toContain('left-justifies');
    expect(text).toContain('3 digits after the decimal point');
    expect(text).toContain('no effect');
  });

  it('says what a length modifier does to the value', () => {
    expect(explainDirective(directive('%hhu'))).toContain('wraps at 8 bits');
    expect(explainDirective(directive('%zu'))).toContain('size_t');
  });

  it('explains %n, %% and a broken directive', () => {
    expect(explainDirective(directive('%n'))).toContain('stores the number');
    expect(explainDirective(directive('%%'))).toContain('takes no argument');
    expect(explainDirective(directive('%q'))).toContain('not a conversion');
  });
});

describe('scanning a complete string', () => {
  it('fails at the end of the input instead of waiting for more', () => {
    const result = scanString('%d %d', '12');
    expect(result.values.map((one) => one.kind)).toEqual(['int']);
    expect(result.failure).toMatchObject({
      directive: '%d',
      found: 'the end of the input',
      endOfInput: true,
    });
    expect(scanReturnValue(result)).toBe(1);
  });

  it('returns EOF for input that ends before the first conversion', () => {
    expect(scanReturnValue(scanString('%d', ''))).toBe(-1);
    expect(scanReturnValue(scanString('%d', '   '))).toBe(-1);
    expect(scanReturnValue(scanString('x%d', ''))).toBe(-1);
  });

  it('returns 0, not EOF, for a matching failure', () => {
    const result = scanString('%d', 'abc');
    expect(result.failure?.endOfInput).toBeUndefined();
    expect(scanReturnValue(result)).toBe(0);
  });

  it('counts a suppressed conversion as one that completed', () => {
    expect(scanReturnValue(scanString('%*d %d', '5'))).toBe(0);
  });

  it('stores nothing for a %c field the input ends inside', () => {
    const result = scanString('%3c', 'ab');
    expect(result.values).toEqual([]);
    expect(result.failure?.endOfInput).toBe(true);
  });

  it('is what scanAll hands the page, with sscanf’s return value', () => {
    expect(scanAll('%d,%d', '3,x')).toEqual({
      values: [{ kind: 'int', value: 3, counted: true }],
      rest: 'x',
      failure: { directive: '%d', found: '"x"', suppressed: false },
      returns: 1,
    });
    expect(scanAll('%s', 'word').failure).toBeNull();
  });
});

describe('printf in a running program', () => {
  it('stores what %n counted, with the width its modifier names', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int n = 0;
  short h = 0;
  char c = 0;
  printf("hello%n, world%hn%hhn\\n", &n, &h, &c);
  printf("%d %d %d\\n", n, h, c);
  return 0;
}`);
    expect(output).toBe('hello, world\n5 12 12\n');
  });

  it('prints the address a char pointer holds for %p, not its characters', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char c = 'A';
  char *p = &c;
  printf("%p|%c\\n", p, *p);
  return 0;
}`);
    expect(output).toMatch(/^0x[0-9a-f]+\|A\n$/);
  });

  it('prints an integer that equals the address of a char as a number', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char c = 'A';
  char *p = &c;
  int address = p;
  printf("%d|%x\\n", address, address);
  return 0;
}`);
    const [decimal, hex] = output.trim().split('|');
    expect(Number(decimal)).toBeGreaterThan(0);
    expect(parseInt(hex, 16)).toBe(Number(decimal));
  });

  it('reports an unknown conversion where it is, and prints nothing for it', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  int x = 1;
  printf("a%qb%d\\n", x);
  printf("next\\n");
  return 0;
}`);
    expect(session.output).toBe('ab1\nnext\n');
    expect(session.output).not.toContain('sprintf:error');
    expect(session.diagnostics).toEqual([
      expect.objectContaining({
        rule: 'unknown-conversion',
        severity: 'error',
        fatal: false,
        line: 4,
      }),
    ]);
  });

  it('reports a missing argument once, however often the loop repeats it', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  int i = 0;
  while (i < 3) {
    printf("%d %d\\n", i);
    i = i + 1;
  }
  return 0;
}`);
    expect(session.output).toBe('0 \n1 \n2 \n');
    expect(session.diagnostics.map((one) => [one.rule, one.line])).toEqual([
      ['missing-argument', 5],
    ]);
  });

  it('returns the number of bytes it wrote', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int n = printf("abc %d\\n", 42);
  printf("%d\\n", n);
  return 0;
}`);
    expect(output).toBe('abc 42\n7\n');
  });

  it('reads a format held in an array', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char format[8] = "<%d>";
  printf(format, 5);
  return 0;
}`);
    expect(output).toBe('<5>');
  });

  it('stops at the end of a char that %s was pointed at', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char c = 'A';
  printf("[%s]\\n", &c);
  return 0;
}`);
    expect(session.output).toBe('[A]\n');
    expect(session.diagnostics.map((one) => one.rule)).toEqual([
      'unterminated-string',
    ]);
  });

  it('refuses a null pointer for %s', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char *p = NULL;
  printf("%s\\n", p);
  return 0;
}`);
    expect(session.diagnostics[0]).toMatchObject({
      rule: 'null-dereference',
      fatal: true,
      line: 4,
    });
  });
});

describe('sprintf', () => {
  it('writes the text and its terminator into the array and returns the length', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char buffer[16];
  int n = sprintf(buffer, "%s-%03d", "id", 7);
  printf("[%s] %d %c %d\\n", buffer, n, buffer[3], buffer[6]);
  return 0;
}`);
    expect(output).toBe('[id-007] 6 0 0\n');
  });

  it('stops the program before writing past the array, naming its size', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char small[4];
  small[0] = 'x';
  sprintf(small, "%d", 12345);
  printf("not reached\\n");
  return 0;
}`);
    expect(session.diagnostics).toEqual([
      expect.objectContaining({
        rule: 'buffer-overflow',
        fatal: true,
        line: 5,
      }),
    ]);
    expect(session.diagnostics[0].message).toContain('small, which is 4 bytes');
    expect(session.diagnostics[0].message).toContain('6 bytes');
    expect(session.output).not.toContain('not reached');
  });

  it('checks a block from malloc against its size', () => {
    const session = run(`#include <stdio.h>
#include <stdlib.h>
int main(void) {
  char *text = malloc(4 * sizeof(char));
  sprintf(text, "%s", "four");
  return 0;
}`);
    expect(session.diagnostics[0].rule).toBe('buffer-overflow');
    expect(session.diagnostics[0].message).toContain('4 bytes long');
  });

  it('refuses to read %s from the array it is writing', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char text[16] = "ab";
  sprintf(text, "%s%s", text, "c");
  return 0;
}`);
    expect(session.diagnostics[0].rule).toBe('overlapping-objects');
  });

  it('refuses a null destination', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char *p = NULL;
  sprintf(p, "%d", 1);
  return 0;
}`);
    expect(session.diagnostics[0].rule).toBe('null-dereference');
  });

  it('stores %n as a count of characters', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char buffer[16];
  int n = 0;
  sprintf(buffer, "abc%nde", &n);
  printf("%d %s\\n", n, buffer);
  return 0;
}`);
    expect(output).toBe('3 abcde\n');
  });
});

describe('snprintf', () => {
  it('truncates, terminates, and returns the length it would have written', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char buffer[6];
  int n = snprintf(buffer, 6, "%s", "hello world");
  printf("[%s] %d\\n", buffer, n);
  return 0;
}`);
    expect(output).toBe('[hello] 11\n');
  });

  it('measures without writing when the size is 0', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int n = snprintf(NULL, 0, "%d", 123456);
  printf("%d\\n", n);
  return 0;
}`);
    expect(output).toBe('6\n');
  });

  it('stops a write that a size larger than the array lets through', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char buffer[4];
  snprintf(buffer, 10, "%s", "abcdef");
  return 0;
}`);
    expect(session.diagnostics[0].rule).toBe('buffer-overflow');
    expect(session.diagnostics[0].message).toContain('size argument (10)');
  });
});

describe('sscanf', () => {
  it('stores the values and returns how many it assigned', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int day = 0;
  double price = 0;
  char name[8];
  int n = sscanf("12 3.5 tea", "%d %lf %s", &day, &price, name);
  printf("%d %d %.1f %s\\n", n, day, price, name);
  return 0;
}`);
    expect(output).toBe('3 12 3.5 tea\n');
  });

  it('returns EOF for a string that ends before the first conversion', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int x = 7;
  int n = sscanf("", "%d", &x);
  printf("%d %d\\n", n, x);
  return 0;
}`);
    expect(output).toBe('-1 7\n');
  });

  it('says which directive failed, as scanf does', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  int a = 0;
  int b = 0;
  int n = sscanf("4 x", "%d %d", &a, &b);
  printf("%d %d %d\\n", n, a, b);
  return 0;
}`);
    expect(output).toBe(
      '[sscanf] %d did not match "x" - sscanf stops at the first directive ' +
        'that fails and returns 1.\n1 4 0\n'
    );
  });

  it('stops a string that does not fit the array it is stored in', () => {
    const session = run(`#include <stdio.h>
int main(void) {
  char word[4];
  sscanf("elephant", "%s", word);
  return 0;
}`);
    expect(session.diagnostics[0].rule).toBe('buffer-overflow');
    expect(session.diagnostics[0].message).toContain('word, which is 4 bytes');
  });

  it('reads a string held in an array, and %n', () => {
    const { output } = run(`#include <stdio.h>
int main(void) {
  char line[16] = "40 2";
  int a = 0;
  int b = 0;
  int used = 0;
  sscanf(line, "%d %d%n", &a, &b, &used);
  printf("%d %d\\n", a + b, used);
  return 0;
}`);
    expect(output).toBe('42 4\n');
  });
});
