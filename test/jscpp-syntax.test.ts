import * as fs from 'fs';
import * as path from 'path';
import { jscppSyntaxError } from '../src/interpreter/jscpp/JscppSyntax';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { LintDiagnostic } from '../src/interpreter/TeachingLint';

/**
 * The syntax check, which is the PEG grammar in `src/interpreter/jscpp` and no
 * longer ANTLR's recovery.
 *
 * Two obligations, and the second is the heavier one. A syntax error refuses
 * the run, so a program this rejects cannot be stepped at all: every valid
 * program here is a guard against the grammar being narrower than the
 * interpreter, which is the one way this change could take a feature away.
 */

const quiet = <T>(run: () => T): T => {
  const error = console.error;
  console.error = () => undefined;
  try {
    return run();
  } finally {
    console.error = error;
  }
};

/** What the reader is told, at the position they are sent to. */
const report = (code: string): string => {
  const found = jscppSyntaxError(code);
  return found === null
    ? 'OK'
    : `${found.line}:${found.column} ${found.message}`;
};

/**
 * The same question asked the way `Server.preflight` asks it, reading the
 * message through `getMsg()` because that is what the server sends on.
 */
const preflight = (code: string): string[] =>
  quiet(() =>
    new PlivetCPP14Interpreter()
      .checkSyntaxError(code)
      .map(
        (error) => `${error.line}:${error.charPositionInLine} ${error.getMsg()}`
      )
  );

describe('the mistakes a beginner makes', () => {
  it('marks a forgotten semicolon at the end of the unfinished line', () => {
    // Not on the statement that tripped over it. The parse fails on line 3,
    // and line 2 is where the reader has to type.
    expect(
      report('int main(void) {\n  int a\n  int b = 1;\n  return b;\n}')
    ).toBe("2:7 expected ';' after this statement");
  });

  it('marks it the same way when the declaration was initialised', () => {
    expect(
      report('int main(void) {\n  int a = 1\n  int b = 2;\n  return b;\n}')
    ).toBe("2:11 expected ';' after this statement");
  });

  it('marks a declaration left half typed on its own line', () => {
    // `int` alone is not a parse error: it merges with the declaration under
    // it and reads as `int int b`. The specifier check is what catches it.
    expect(
      report('int main(void) {\n  int\n  int b = 1;\n  return b;\n}')
    ).toBe("2:5 expected ';' after this statement");
  });

  it('names the two types when a declaration really does name two', () => {
    expect(report('int main(void) {\n  int char c;\n  return 0;\n}')).toBe(
      '2:2 this declaration names more than one type'
    );
  });

  it('reports an empty right-hand side as the missing expression', () => {
    expect(report('int main(void) {\n  int a = ;\n  return a;\n}')).toBe(
      "2:10 expected an expression after '='"
    );
  });

  it('reports one unbalanced parenthesis once, on its own line', () => {
    // ANTLR answered this with three errors, two of them on lines 1 and 2 of
    // a program whose only fault is on line 2.
    expect(report('int main(void) {\n  printf("hi";\n  return 0;\n}')).toBe(
      "2:13 expected ',' or ')' before ';'"
    );
  });

  it('sends an unclosed block to the brace that opened it', () => {
    expect(report('int main(void) {\n  int a = 1;\n  return a;\n')).toBe(
      "1:15 expected '}' to close this block"
    );
  });

  it('does not count a brace inside a string literal as a block', () => {
    expect(report('int main(void) {\n  char *s = "{";\n  return 0;\n')).toBe(
      "1:15 expected '}' to close this block"
    );
  });

  it('reports a closing brace with nothing open as unexpected', () => {
    expect(report('int main(void) {\n  int a = 1;\n}\n}')).toBe(
      "4:0 unexpected '}'"
    );
  });

  it('widens the reported token past the single character PEG.js gives', () => {
    // `found` is one character, so this would otherwise read `before 'i'`.
    expect(report('int f(int a int b) { return a; }')).toBe(
      "1:12 expected ',' or ')' before 'int'"
    );
  });
});

describe('a qualifier where a declaration cannot have one', () => {
  /**
   * These were invisible until the check stopped reading the source ANTLR
   * reads. `DeclarationSpecifiers.rewrite` blanks `const`, `volatile`,
   * `restrict` and `_Atomic` in place, so `int x volatile;` arrived as
   * `int x         ;` - a valid declaration by the time anything parsed it.
   * The check now reads a source those passes have not been over.
   */
  it('rejects a qualifier after the declarator', () => {
    expect(report('int main(void) {\n  int x volatile;\n  return 0;\n}')).toBe(
      "2:8 expected ';' or ',' before 'volatile'"
    );
  });

  it('rejects the reported case', () => {
    expect(
      report(
        'int main(void) {\n  int register const local volatile;\n  return 0;\n}'
      )
    ).toBe("2:27 expected ';' or ',' before 'volatile'");
  });

  it.each([
    ['const before the type', 'int main(void) { const int x = 1; return x; }'],
    ['const after the type', 'int main(void) { int const x = 1; return x; }'],
    [
      'a storage class and a qualifier',
      'int main(void) { static const int x = 1; return x; }',
    ],
    [
      'a const pointer',
      'int main(void) { int a = 1; int *const p = &a; return *p; }',
    ],
    [
      'a volatile member',
      'struct S { volatile int r; };\nint main(void) { struct S s; s.r = 1; return s.r; }',
    ],
    [
      '_Atomic as a specifier',
      '_Atomic(int) n = 1;\nint main(void) { return n; }',
    ],
    [
      '_Atomic as a qualifier',
      '_Atomic int n = 1;\nint main(void) { return n; }',
    ],
  ])('accepts %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('a character constant with no character in it', () => {
  /**
   * `printf('')` is not C, and until the grammar was asked about it nothing
   * in PLIVET said so. The grammar's `Char*` accepted the empty list, and
   * ANTLR's lexer - which cannot tokenize `''` at all - reported it to a
   * console listener nobody reads and dropped the token. The statement built
   * from what was left was not executable, so the first step ran the program
   * to end of file with no output and no diagnostic: the reader was told
   * nothing at all about a line they had to fix.
   */
  it('marks the constant, and refuses the run', () => {
    const code = "int main(void) {\n  int a;\n  printf('');\n  return a;\n}";
    expect(report(code)).toBe('3:9 empty character constant');
    expect(preflight(code)).toEqual(['3:9 line 3:9 empty character constant']);
  });

  it('marks it on the reported program, qualifiers and all', () => {
    expect(
      report(
        "int main(void) {\n  int const register volatile a;\n  printf('');\n}"
      )
    ).toBe('3:9 empty character constant');
  });

  it.each([
    ['a character', "int main(void) { char c = 'a'; return c; }"],
    ['an escape', "int main(void) { char c = '\\n'; return c; }"],
    ['an escaped quote', "int main(void) { char c = '\\''; return c; }"],
    // Implementation-defined rather than invalid: clang warns and compiles.
    [
      'a multi-character constant',
      "int main(void) { int c = 'ab'; return c; }",
    ],
    ['an empty string', 'int main(void) { char *s = ""; return s[0]; }'],
    [
      'quotes inside a string',
      'int main(void) { char *s = "\'\'"; return s[0]; }',
    ],
  ])('says nothing about %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('a jump the interpreter cannot make', () => {
  /**
   * `goto` and the label it jumps to are both valid C, and unicoen executes
   * neither: a function holding a label stops there, printing what came
   * before it and nothing after, with no diagnostic of any kind. The grammar
   * has no rule for a label either, so the refusal already happened - but it
   * read `expected ';' or ',' before ':'`, which sent the reader to correct
   * punctuation that was not wrong. Refusing it by name is the whole change;
   * teaching the grammar the rule would have turned a wrong message into a
   * silent half-run, which is worse.
   */
  it.each([
    ['a label', 'int main(void){\n  goto done;\ndone:\n  return 0;\n}'],
    ['a label alone', 'int main(void){\ndone:\n  return 0;\n}'],
    ['a backward jump', 'int main(void){\ntop:\n  goto top;\n}'],
  ])('refuses %s, and marks the label rather than the colon', (_name, code) => {
    const found = jscppSyntaxError(code);
    expect(found).not.toBeNull();
    expect(found!.column).toBe(0);
    expect(found!.message).toContain('labelled statement');
  });

  it('refuses a goto whose label is nowhere in the parse', () => {
    // Nothing fails to parse here, so `describe` never runs: without the tree
    // check this program was stepped, and stopped at the jump in silence.
    expect(report('int main(void){\n  goto done;\n  return 0;\n}')).toBe(
      "2:2 'goto' cannot be stepped"
    );
  });

  it.each([
    [
      'a conditional expression',
      'int main(void){ int a = 1 ? 2 : 3; return a; }',
    ],
    [
      'a case label',
      'int main(void){ int x = 1; switch (x) { case 1: break; default: break; } return 0; }',
    ],
    [
      'a member selector',
      'struct S { int a; };\nint main(void){ struct S s; s.a = 1; return s.a; }',
    ],
  ])('says nothing about %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('a compound shift the mapper loses', () => {
  /**
   * ANTLR's C++14 grammar splits `>>` so nested template arguments close, and
   * `>>=` does not survive it: the tree holds the two halves as separate
   * statements with no operator between them. The shift never happens, `y`
   * keeps its old value, and the program runs on to a wrong answer - which is
   * worse than stopping, because nothing about the run looks wrong. Refused
   * rather than repaired: the operator is gone before any pass here can see
   * it.
   */
  it('refuses it, and says what to write instead', () => {
    expect(
      preflight('int main(void){\n  int y = 14;\n  y >>= 1;\n  return y;\n}')
    ).toEqual([
      "3:4 line 3:4 '>>=' cannot be stepped; write it as 'x = x >> n'",
    ]);
  });

  it.each([
    ['the shift itself', 'int main(void){ int y = 28; return y >> 2; }'],
    [
      'a left shift assignment',
      'int main(void){ int y = 1; y <<= 3; return y; }',
    ],
    ['a comparison', 'int main(void){ int y = 1; return y >= 1; }'],
    [
      'the operator inside a string',
      'int main(void){ char *s = ">>="; return s[0]; }',
    ],
  ])('says nothing about %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('a declaration that declares nothing', () => {
  /**
   * `int volatile register;` names a type and then no object. C requires a
   * declaration to declare a declarator, a tag or the members of an
   * enumeration, and clang reports exactly this - but as a warning: the
   * program compiles and runs, so refusing it would be stricter than a
   * compiler for nothing. It is reported, and the run still goes ahead.
   */
  const lints = (code: string): LintDiagnostic[] =>
    quiet(() =>
      new PlivetCPP14Interpreter()
        .getLints(code)
        .filter((diagnostic) => diagnostic.rule === 'empty-declaration')
    );

  it('warns, and does not refuse the run', () => {
    const code = 'int volatile register;\nint main(void) { return 0; }';
    const [found] = lints(code);
    expect(found).toBeDefined();
    expect(found.severity).toBe('warning');
    expect(found.line).toBe(1);
    expect(found.message).toContain('declares nothing');
    expect(preflight(code)).toEqual([]);
  });

  it('warns inside a function too', () => {
    const found = lints('int main(void) {\n  int;\n  return 0;\n}');
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });

  it.each([
    [
      'a struct definition',
      'struct S { int a; };\nint main(void) { return 0; }',
    ],
    [
      'a forward declaration',
      'struct S;\nstruct S { int a; };\nint main(void) { return 0; }',
    ],
    ['an enum definition', 'enum E { A, B };\nint main(void) { return A; }'],
    ['a union definition', 'union U { int a; };\nint main(void) { return 0; }'],
    ['an ordinary declaration', 'int main(void) { int x = 1; return x; }'],
    [
      'a prototype with an abstract parameter',
      'int f(int);\nint f(int a) { return a; }\nint main(void) { return f(1); }',
    ],
  ])('says nothing about %s', (_name, code) => {
    expect(lints(code)).toEqual([]);
  });
});

describe('more than one storage class in one declaration', () => {
  /**
   * C allows a declaration at most one storage class - 6.7.1 constraint 2 -
   * and a second one is a hard error everywhere: clang refuses `static extern
   * int x;` with `cannot combine with previous 'static' declaration
   * specifier`, gcc with `multiple storage classes in declaration
   * specifiers`. Nothing here said so, and the reader was shown a variable
   * whose region PLIVET had picked for them out of two contradictory words.
   */
  it.each([
    ['static then extern', 'static extern int x = 1;', "'extern'", "'static'"],
    ['extern then static', 'extern static int x;', "'static'", "'extern'"],
    ['auto then static', 'auto static int x = 1;', "'static'", "'auto'"],
    ['register then auto', 'register auto int x = 1;', "'auto'", "'register'"],
  ])('rejects %s', (_name, declaration, second, first) => {
    const found = report(`int main(void) {\n  ${declaration}\n  return 0;\n}`);
    expect(found).toContain(`cannot combine ${second} with previous ${first}`);
  });

  it('points at the second word, the way a compiler does', () => {
    // Column 9: the `e` of `extern`, not the start of the declaration. The
    // first word is not the wrong one, and marking it sends the reader to the
    // keyword they meant to keep.
    expect(
      report('int main(void) {\n  static extern int x = 1;\n  return 0;\n}')
    ).toBe("2:9 cannot combine 'extern' with previous 'static'");
  });

  it('counts typedef as the storage class it is', () => {
    // The grammar takes `typedef` in a rule of its own, so the word is not in
    // the specifier list the check reads and had to be put back by hand.
    expect(
      report('typedef static int Count;\nint main(void) { return 0; }')
    ).toBe("1:8 cannot combine 'static' with previous 'typedef'");
  });

  it('refuses the run, through checkSyntaxError', () => {
    expect(
      preflight('int main(void) {\n  static extern int x = 1;\n  return x;\n}')
    ).toEqual(["2:9 line 2:9 cannot combine 'extern' with previous 'static'"]);
  });

  /**
   * The same word twice is the one case that must not refuse the run. clang
   * warns about `static static int x;` and compiles it, the object is kept
   * exactly where one `static` would have kept it, and refusing a program a
   * compiler accepts is the worse of the two mistakes.
   */
  describe('the same storage class written twice', () => {
    const duplicates = (code: string): LintDiagnostic[] =>
      quiet(() =>
        new PlivetCPP14Interpreter()
          .getLints(code)
          .filter((diagnostic) => diagnostic.rule === 'duplicate-storage-class')
      );

    it('warns, and lets the program run', () => {
      const code =
        'int main(void) {\n  static static int x = 1;\n  return x;\n}';
      const [found] = duplicates(code);
      expect(found).toBeDefined();
      expect(found.severity).toBe('warning');
      expect(found.line).toBe(2);
      expect(found.column).toBe(9);
      expect(found.message).toContain('says static twice');
      expect(report(code)).toBe('OK');
      expect(preflight(code)).toEqual([]);
    });

    it('says nothing about one storage class', () => {
      expect(
        duplicates('int main(void) {\n  static int x = 1;\n  return x;\n}')
      ).toEqual([]);
    });
  });

  it.each([
    ['static alone', 'int main(void) { static int x = 1; return x; }'],
    ['extern alone', 'extern int g;\nint main(void) { return 0; }'],
    ['auto alone', 'int main(void) { auto int x = 1; return x; }'],
    ['register alone', 'int main(void) { register int x = 1; return x; }'],
    [
      'a storage class beside qualifiers',
      'int main(void) { static const volatile int x = 1; return x; }',
    ],
    [
      'a static function',
      'static int f(void) { return 1; }\nint main(void) { return f(); }',
    ],
    [
      'a register parameter',
      'int f(register int a) { return a; }\nint main(void) { return f(1); }',
    ],
    [
      'a plain typedef',
      'typedef unsigned int Count;\nint main(void) { Count c = 1; return (int)c; }',
    ],
  ])('accepts %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('valid C the check must not refuse', () => {
  const accepted: [string, string][] = [
    [
      'an empty case falling into the next',
      // ANTLR rejected this outright, so it could not be stepped at all.
      'int main(void) {\n  int x = 1;\n  switch (x) {\n    case 1:\n    case 2:\n      x = 9;\n      break;\n    default:\n      x = 0;\n  }\n  return x;\n}',
    ],
    [
      'default falling into a case',
      'int main(void) {\n  int x = 1;\n  switch (x) {\n    default:\n    case 1:\n      x = 9;\n  }\n  return x;\n}',
    ],
    ['a volatile local', 'int main(void) { volatile int x = 1; return x; }'],
    [
      'a volatile struct member',
      'struct S { volatile int r; };\nint main(void) { return 0; }',
    ],
    [
      'a restrict parameter',
      'void f(int *restrict p) { (void)p; }\nint main(void) { return 0; }',
    ],
    [
      'a stray semicolon at file scope',
      // What `FunctionPointerTable.apply` leaves behind, and legal C besides.
      'int f(void) { return 1; }\n;\nint main(void) { return f(); }',
    ],
    [
      'unsigned long long',
      'int main(void) { unsigned long long x = 1; return (int)x; }',
    ],
    ['long double', 'int main(void) { long double d = 1.5; return (int)d; }'],
    [
      'a function pointer through a typedef',
      'typedef int (*Op)(int, int);\nint add(int a, int b) { return a + b; }\nint main(void) { Op op = add; return op(1, 2); }',
    ],
    [
      'an array of function pointers',
      'int f(int a) { return a; }\nint main(void) { int (*ops[2])(int) = {f, f}; return ops[0](1); }',
    ],
    [
      'a semicolon inside a string literal',
      'int main(void) { char *s = ";"; return s[0]; }',
    ],
    [
      'a semicolon as a character literal',
      "int main(void) { char c = ';'; return c; }",
    ],
  ];

  it.each(accepted)('accepts %s', (_name, code) => {
    expect(report(code)).toBe('OK');
  });
});

describe('the whole pipeline', () => {
  /**
   * The grammar reads what `prepare()` produced, not what the reader typed:
   * the rewrite passes turn designated initializers, enums and function
   * pointers into forms the grammar has a rule for. Checking the teaching
   * programs end to end is what proves those two halves still agree.
   */
  const dir = path.join(__dirname, 'programs');
  const programs = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.c'))
    .map((name): [string, string] => [name, path.join(dir, name)]);

  it.each(programs)('accepts test/programs/%s', (_name, file) => {
    expect(preflight(fs.readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('refuses a program the grammar rejects, through checkSyntaxError', () => {
    expect(preflight('int main(void) {\n  int a\n  return a;\n}')).toEqual([
      "2:7 line 2:7 expected ';' after this statement",
    ]);
  });

  it('reports one error rather than a cascade', () => {
    // The trade the PEG grammar makes: no recovery, so no second guess after
    // the first failure. ANTLR's extra errors were on lines that were fine.
    expect(
      preflight('int main(void) {\n  printf("hi";\n  return 0;\n}')
    ).toHaveLength(1);
  });
});
