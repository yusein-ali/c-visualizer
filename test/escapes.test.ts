import { decodeEscapes, decodedText } from '../src/interpreter/Escapes';
import { unknownEscapes } from '../src/interpreter/TeachingLint';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec, outputOf, valueOf } from './library';

/*
 * Escape sequences in string and character literals (C11 6.4.4.4).
 * unicoen.ts decoded them with a chain of replacements ending in
 * `\\ -> \` and then `\ -> /`, so `"a\\nb"` printed `a/`, a newline and `b`.
 */

const codes = (text: string): number[] =>
  Array.from(text, (character) => character.charCodeAt(0));

describe('decoding a literal', () => {
  it('reads a doubled backslash as one backslash, and nothing more', () => {
    expect(decodedText('a\\\\nb')).toBe('a\\nb');
    expect(decodedText('\\\\')).toBe('\\');
    expect(decodedText('C:\\\\dir\\\\file')).toBe('C:\\dir\\file');
  });

  it('reads every simple escape', () => {
    expect(codes(decodedText('\\\'\\"\\?\\\\\\a\\b\\f\\n\\r\\t\\v'))).toEqual([
      39, 34, 63, 92, 7, 8, 12, 10, 13, 9, 11,
    ]);
  });

  it('reads octal escapes of one to three digits', () => {
    expect(codes(decodedText('\\0'))).toEqual([0]);
    expect(codes(decodedText('\\101\\60'))).toEqual([65, 48]);
    // Three digits at most: the fourth is a character of its own.
    expect(decodedText('\\1011')).toBe('A1');
  });

  it('reads hexadecimal escapes', () => {
    expect(decodedText('\\x41\\x62')).toBe('Ab');
    expect(codes(decodedText('\\xff'))).toEqual([255]);
  });

  it('does not decode what an earlier escape produced', () => {
    // `\\x41` is a backslash followed by `x41`, not an `A`.
    expect(decodedText('\\\\x41')).toBe('\\x41');
  });

  it('reports an unknown escape and keeps the character after it', () => {
    expect(decodeEscapes('a\\qb')).toEqual({
      text: 'aqb',
      unknown: [{ text: '\\q', offset: 1 }],
    });
  });
});

describe('literals in a running program', () => {
  it('prints backslashes and escapes the way C does', async () => {
    const output = await outputOf(`#include <stdio.h>
int main(void) {
  char s[] = "a\\\\nb";
  char c = '\\\\';
  char q = '\\'';
  printf("%s|%c|%c|%d\\n", s, c, q, (int)sizeof(s));
  printf("x\\ty\\101\\x42\\?\\"\\n");
  printf("back\\\\slash %s\\n", "C:\\\\tmp");
  return 0;
}
`);
    expect(output).toBe('a\\nb|\\|\'|5\nx\tyAB?"\nback\\slash C:\\tmp\n');
  });

  it('stores the decoded bytes in the array the canvas draws', async () => {
    const run = await exec(`int main(void) {
  char s[] = "\\\\n";
  char c = '\\101';
  return 0;
}
`);
    expect(valueOf(run.model, 's[0]')).toBe("92 '\\'");
    expect(valueOf(run.model, 's[1]')).toBe("110 'n'");
    expect(valueOf(run.model, 'c')).toBe("65 'A'");
  });
});

describe('the unknown-escape lint', () => {
  it('warns where the escape is written', () => {
    const source = `int main(void) {\n  char *p = "C:\\qfile";\n  return 0;\n}\n`;
    expect(unknownEscapes(source)).toEqual([
      expect.objectContaining({
        rule: 'unknown-escape',
        severity: 'warning',
        line: 2,
        column: 15,
        endColumn: 17,
      }),
    ]);
  });

  it('says nothing about escapes C defines, or about comments', () => {
    const source =
      '// a \\q in a comment\nint main(void) { char *p = "\\\\q\\n\\x41"; char c = \'\\\\\'; return 0; }\n';
    expect(unknownEscapes(source)).toEqual([]);
  });

  it('reaches the editor through the program lints', () => {
    const interpreter = new PlivetCPP14Interpreter();
    const lints = interpreter.getLints(
      '#include <stdio.h>\nint main(void) { printf("\\d\\n"); return 0; }\n'
    );
    expect(lints.map((lint) => lint.rule)).toContain('unknown-escape');
  });
});
