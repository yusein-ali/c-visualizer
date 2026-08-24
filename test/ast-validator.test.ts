import { CPP14Mapper } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Mapper';
import { Interpreter } from 'unicoen.ts/dist/interpreter/Interpreter';
import { validateAst } from '../src/interpreter/AstValidator';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { Server } from '../src/core/server';
import { defaultProgram } from '../src/defaultProgram';

const tourFiles = () => defaultProgram().files.map((file) => ({ ...file }));

const check = (files: { path: string; text: string }[], active: string) =>
  new Server().send({
    controlEvent: 'SyntaxCheck',
    sourcecode: files.find((file) => file.path === 'main.c')?.text ?? '',
    files,
    entry: 'main.c',
    active,
  });

const validate = (code: string) =>
  validateAst(new CPP14Mapper().parseToUniTree(code), code);

const syntaxErrors = (code: string) =>
  new PlivetCPP14Interpreter()
    .checkSyntaxError(code)
    .map(
      (error) => `${error.line}:${error.charPositionInLine} ${error.getMsg()}`
    );

/**
 * The case the pass exists for: ANTLR recovers an uninitialised declaration
 * with no semicolon in silence, so nothing else reports it.
 */
describe('a declaration with no semicolon', () => {
  const code = [
    '#include <stdio.h>',
    '',
    'int main(void) {',
    '    int a',
    '    printf("A");',
    '    return 0;',
    '}',
  ].join('\n');

  it('is reported', () => {
    expect(validate(code)).toEqual([
      { line: 4, column: 9, message: "expected ';' after declaration" },
    ]);
  });

  it('marks the line the reader has to edit, not the enclosing brace', () => {
    // The block's own coordinate is 3:15, the `{` of main. The sentence is
    // the grammar's in `jscpp/`, which now answers this question - see
    // `jscpp-syntax.test.ts`; this pass reads the same line out of the tree.
    expect(syntaxErrors(code)).toEqual([
      "4:9 line 4:9 expected ';' after this statement",
    ]);
  });

  it('refuses the run', async () => {
    const response = await new Server().send({
      controlEvent: 'Exec',
      sourcecode: code,
    });
    expect(response.debugState).toBe('Stop');
    expect(response.errors).toHaveLength(1);
  }, 30000);

  it('takes one line per stray token', () => {
    const two = [
      'int main(void) {',
      '    int a',
      '    printf("A");',
      '    int b',
      '    printf("B");',
      '    return 0;',
      '}',
    ].join('\n');
    expect(validate(two).map((error) => error.line)).toEqual([2, 4]);
  });
});

/**
 * A semicolon inside a literal is not a missing delimiter. Reading every
 * string field of every node once made these valid programs unrunnable:
 * `Server.preflight` refuses a program that reports a syntax error.
 */
describe('a semicolon inside a literal', () => {
  it.each([
    ['string literal', 'int main(){\n  printf(";");\n  return 0;\n}'],
    ['char literal', "int main(){\n  char c = ';';\n  return 0;\n}"],
    [
      'both',
      'int main(){\n  char c = \';\';\n  printf("; %c", c);\n  return 0;\n}',
    ],
  ])('is not an error: %s', (_name, code) => {
    expect(validate(code)).toEqual([]);
    expect(syntaxErrors(code)).toEqual([]);
  });

  it('is not refused the run', async () => {
    const response = await new Server().send({
      controlEvent: 'Exec',
      sourcecode: 'int main(){\n  printf(";");\n  return 0;\n}',
    });
    // `preflight` answers a refusal as a stopped session carrying the errors;
    // an accepted run is already stepping when the first response returns.
    expect(response.errors).toEqual([]);
    expect(response.debugState).toBe('Executing');
  }, 30000);
});

describe('what the parser already reports', () => {
  it("is not repeated, and no longer answered with ANTLR's cascade", () => {
    const code = 'int main(){\n  int a = 1\n  printf("A");\n  return 0;\n}';
    const interpreter = new PlivetCPP14Interpreter();
    const stock = Interpreter.prototype.checkSyntaxError
      .call(interpreter, interpreter.preProcess(code))
      .map((error) => `${error.line}:${error.charPositionInLine}`);
    // ANTLR recovers, and recovery reports the same mistake twice - both
    // times on line 3, which the reader has not touched. The grammar in
    // `jscpp/` stops at the first token that cannot continue and hands back
    // one position: the end of line 2, where the semicolon is missing.
    expect(stock).toEqual(['3:2', '3:2']);
    expect(syntaxErrors(code).map((error) => error.split(' ')[0])).toEqual([
      '2:11',
    ]);
  });
});

describe('a program that parses', () => {
  it('reports nothing', () => {
    const code = [
      '#include <stdio.h>',
      'struct Point { int x; int y; };',
      'int main(void) {',
      '    struct Point p = { 1, 2 };',
      '    int a = p.x;',
      '    for (int i = 0; i < 2; i++) {',
      '        printf("%d", a);',
      '    }',
      '    return 0;',
      '}',
    ].join('\n');
    expect(validate(code)).toEqual([]);
    expect(syntaxErrors(code)).toEqual([]);
  });
});

/**
 * A stray `;` in a statement list is not by itself a fault. `tour.h` leaves
 * one in a header that parses, and reading it as a missing delimiter refused
 * the run of the program the visualizer ships with.
 */
describe('the three-file tour', () => {
  it.each(['main.c', 'tour.h', 'tour.c'])(
    'reports nothing for %s',
    async (active) => {
      const response = await check(tourFiles(), active);
      expect(response.errors).toEqual([]);
    },
    30000
  );

  it('runs', async () => {
    const files = tourFiles();
    const response = await new Server().send({
      controlEvent: 'Exec',
      sourcecode: files.find((file) => file.path === 'main.c')?.text ?? '',
      files,
      entry: 'main.c',
      active: 'main.c',
    });
    expect(response.fileErrors ?? []).toEqual([]);
    expect(response.debugState).toBe('Executing');
  }, 30000);

  /**
   * Half a declaration, as the reader has it a keystroke after typing `int`.
   * One mistake leaves three stray tokens in the block; only the line that is
   * visibly missing its semicolon is worth a mark, and the other files are
   * not involved at all.
   */
  describe('while a declaration is half typed', () => {
    const halfTyped = () => {
      const files = tourFiles();
      const main = files.find((file) => file.path === 'main.c');
      const lines = (main?.text ?? '').split('\n');
      lines.splice(10, 0, '  int');
      return files.map((file) =>
        file.path === 'main.c' ? { ...file, text: lines.join('\n') } : file
      );
    };

    it('marks that line once', async () => {
      const response = await check(halfTyped(), 'main.c');
      expect(response.errors).toEqual([
        {
          line: 11,
          charPositionInLine: 5,
          msg: "line 11:5 expected ';' after this statement",
        },
      ]);
    }, 30000);

    it('leaves the header alone', async () => {
      const response = await check(halfTyped(), 'tour.h');
      expect(response.errors).toEqual([]);
    }, 30000);
  });
});
