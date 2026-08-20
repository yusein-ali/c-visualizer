import { scan, ScanResult } from '../src/interpreter/scanf';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';

/**
 * The matching rules in `src/interpreter/scanf.ts`, and the two of them that
 * are the point of the exercise: a conversion that cannot match assigns
 * nothing, and leaves the character that could not be converted for the next
 * read.
 */
const scanAll = (
  format: string,
  input: string,
  lines: string[] = []
): ScanResult => {
  const scanner = scan(format, input);
  const pending = [...lines];
  let step = scanner.next('');
  while (!step.done) {
    if (pending.length === 0) {
      throw new Error('the scan asked for input the test did not give it');
    }
    step = scanner.next(`${pending.shift()}\n`);
  }
  return step.value;
};

const numbers = (result: ScanResult) =>
  result.values.map((value) =>
    value.kind === 'int' || value.kind === 'float' ? value.value : value.text
  );

describe('a conversion that cannot match', () => {
  it('assigns nothing and reports nothing', () => {
    expect(scanAll('%d', 'abc\n').values).toEqual([]);
  });

  it('leaves the offending input for the next read', () => {
    expect(scanAll('%d', 'abc\n').rest).toBe('abc\n');
  });

  it('stops the call, so a later conversion does not run', () => {
    expect(numbers(scanAll('%d %d', 'abc 12\n'))).toEqual([]);
  });

  it('keeps what earlier conversions already assigned', () => {
    const result = scanAll('%d %d', '7 x\n');
    expect(numbers(result)).toEqual([7]);
    expect(result.rest).toBe('x\n');
  });

  it('reports what could not be matched, and against what', () => {
    expect(scanAll('%d', 'abc\n').failure).toEqual({
      directive: '%d',
      found: '"abc"',
      suppressed: false,
    });
  });

  it('names a whitespace character rather than quoting it', () => {
    expect(scanAll('%d,%d', '1 2\n').failure).toEqual({
      directive: '","',
      found: 'a space',
      suppressed: false,
    });
  });

  it('reports nothing when every directive matched', () => {
    expect(scanAll('%d', '1\n').failure).toBeUndefined();
  });

  it('is what an ordinary character in the format does too', () => {
    const result = scanAll('%d,%d', '1 2\n');
    expect(numbers(result)).toEqual([1]);
    expect(result.rest).toBe(' 2\n');
  });
});

describe('integer conversions', () => {
  it('reads a decimal number and keeps the rest of the line', () => {
    const result = scanAll('%d', '  42abc\n');
    expect(numbers(result)).toEqual([42]);
    expect(result.rest).toBe('abc\n');
  });

  it('reads a sign', () => {
    expect(numbers(scanAll('%d', '-7\n'))).toEqual([-7]);
  });

  it('honours a field width', () => {
    const result = scanAll('%3d', '12345\n');
    expect(numbers(result)).toEqual([123]);
    expect(result.rest).toBe('45\n');
  });

  it('reads hexadecimal for %x and octal for %o', () => {
    expect(numbers(scanAll('%x %o', 'ff 17\n'))).toEqual([255, 15]);
  });

  it('takes the base from the input for %i', () => {
    expect(numbers(scanAll('%i %i %i', '0x1f 017 12\n'))).toEqual([31, 15, 12]);
  });
});

describe('floating point conversions', () => {
  it('reads a fraction and an exponent', () => {
    expect(numbers(scanAll('%f %f', '3.5 -1e3\n'))).toEqual([3.5, -1000]);
  });

  it('rejects a token that is not a number at all', () => {
    expect(scanAll('%f', 'x\n').values).toEqual([]);
  });
});

describe('character and string conversions', () => {
  it('reads one character with %c, whitespace included', () => {
    const result = scanAll('%c', ' ab\n');
    expect(numbers(result)).toEqual([' ']);
    expect(result.rest).toBe('ab\n');
  });

  it('reads a field of characters with a width', () => {
    expect(numbers(scanAll('%2c', 'abc\n'))).toEqual(['ab']);
  });

  it('reads a whitespace-delimited token with %s', () => {
    const result = scanAll('%s', '  hello world\n');
    expect(numbers(result)).toEqual(['hello']);
    expect(result.rest).toBe(' world\n');
  });

  it('reads only what a scanset admits', () => {
    const result = scanAll('%[a-z]', 'abc123\n');
    expect(numbers(result)).toEqual(['abc']);
    expect(result.rest).toBe('123\n');
  });

  it('reads the rest of the line with a negated scanset', () => {
    expect(numbers(scanAll('%[^\n]', 'a b c\n'))).toEqual(['a b c']);
  });
});

describe('the format string', () => {
  it('drops a suppressed conversion instead of assigning it', () => {
    expect(numbers(scanAll('%*d %d', '1 2\n'))).toEqual([2]);
  });

  it('does not count %n as a conversion', () => {
    const result = scanAll('%d%n', '12ab\n');
    expect(result.values.map((value) => value.counted)).toEqual([true, false]);
    expect(numbers(result)).toEqual([12, 2]);
  });

  it('matches a literal %% against a %', () => {
    expect(numbers(scanAll('%d%%', '50%\n'))).toEqual([50]);
  });

  it('skips whitespace already read rather than waiting for more', () => {
    // In C `scanf("%d\n")` blocks until a non-blank character arrives. Waiting
    // for input no conversion will use reads as a hung program here, so the
    // trailing directive settles for the whitespace it has.
    expect(scanAll('%d\n', '1\n').rest).toBe('');
  });
});

describe('input that arrives a line at a time', () => {
  it('waits for a second line to finish a second conversion', () => {
    expect(numbers(scanAll('%d %d', '3\n', ['4']))).toEqual([3, 4]);
  });

  it('waits through a line with nothing on it', () => {
    expect(numbers(scanAll('%d', '', ['', '5']))).toEqual([5]);
  });
});

/** The engine half: the values reach the variables and the count is returned. */
const runWithInput = (code: string, lines: string[]): string => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  const log = console.log;
  console.log = () => undefined; // the engine dumps every stack frame it builds
  try {
    interpreter.startStepExecution(code);
    const pending = [...lines];
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < 20000) {
      if (interpreter.getIsWaitingForStdin()) {
        if (pending.length === 0) {
          break; // the program is asking for input the test does not have
        }
        interpreter.stdin(pending.shift() as string);
      }
      interpreter.stepExecute();
      steps += 1;
    }
    return interpreter.getStdout();
  } finally {
    console.log = log;
  }
};

/** The note a failed `%d` writes into the program's output. */
const NOTE_ABC =
  '[scanf] %d did not match "abc" - it stays in the input, so the next read' +
  ' starts there.';

describe('scanf in a running program', () => {
  it('reads two numbers from two lines', () => {
    const code = `#include<stdio.h>
int main(){ int a = 0; int b = 0; scanf("%d", &a); scanf("%d", &b);
  printf("%d\\n", a + b); return 0; }`;
    expect(runWithInput(code, ['3', '4'])).toBe('3\n4\n7\n');
  });

  it('leaves the variable alone and returns 0 on a letter', () => {
    const code = `#include<stdio.h>
int main(){ int n = -1; int r = scanf("%d", &n);
  printf("r=%d n=%d\\n", r, n); return 0; }`;
    expect(runWithInput(code, ['abc'])).toBe(`abc\n${NOTE_ABC}\nr=0 n=-1\n`);
  });

  it('reads both numbers a single line holds', () => {
    const code = `#include<stdio.h>
int main(){ int a = 0; int b = 0; int r = scanf("%d %d", &a, &b);
  printf("r=%d a=%d b=%d\\n", r, a, b); return 0; }`;
    expect(runWithInput(code, ['3 4'])).toBe('3 4\nr=2 a=3 b=4\n');
  });

  it('lets the read-check-retry loop a course teaches converge', () => {
    const code = `#include<stdio.h>
int main(){
  int n = 0;
  int r = 0;
  while (r != 1) {
    r = scanf("%d", &n);
    if (r != 1) { scanf("%*[^\\n]"); }
  }
  printf("got %d\\n", n); return 0; }`;
    expect(runWithInput(code, ['abc', '5'])).toBe(
      `abc\n${NOTE_ABC}\n5\ngot 5\n`
    );
  });

  it('says why a second read did not stop for input either', () => {
    // The read that follows a failure trips over the same characters and
    // returns 0 without waiting, which in a step debugger is indistinguishable
    // from a statement that never ran. This is the only thing that says
    // otherwise.
    const code = `#include<stdio.h>
int main(){ int a = -1; int b = -1;
  int r1 = scanf("%d", &a);
  int r2 = scanf("%d", &b);
  printf("r1=%d a=%d r2=%d b=%d\\n", r1, a, r2, b); return 0; }`;
    expect(runWithInput(code, ['abc'])).toBe(
      `abc\n${NOTE_ABC}\nr1=0 a=-1 r2=0 b=-1\n`
    );
  });

  it('does not repeat the note while a loop fails the same way', () => {
    const code = `#include<stdio.h>
int main(){ int n = 0; int i = 0;
  while (i < 3) { scanf("%d", &n); i = i + 1; }
  printf("done\\n"); return 0; }`;
    expect(runWithInput(code, ['abc'])).toBe(`abc\n${NOTE_ABC}\ndone\n`);
  });

  it('says nothing when the failed conversion was a deliberate discard', () => {
    const code = `#include<stdio.h>
int main(){ scanf("%*[0-9]"); printf("done\\n"); return 0; }`;
    expect(runWithInput(code, ['abc'])).toBe('abc\ndone\n');
  });

  it('reads a string into a char array', () => {
    const code = `#include<stdio.h>
int main(){ char s[8]; scanf("%s", s); printf("[%s]\\n", s); return 0; }`;
    expect(runWithInput(code, ['hello'])).toBe('hello\n[hello]\n');
  });
});
