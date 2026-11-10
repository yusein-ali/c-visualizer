import { ANTLRInputStream, Token } from 'antlr4ts';
import { CPP14Lexer } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Lexer';
import { ShiftAssignLexer } from '../src/interpreter/ShiftAssignLexer';

/**
 * The lexer that gives `>>=` to the grammar as `>`, `>` and `=`, the three
 * tokens its `rightShiftAssign` rule asks for, where unicoen's lexer gave `>`
 * and `>=`.
 */

const NAMES: Record<number, string> = {
  [CPP14Lexer.Greater]: '>',
  [CPP14Lexer.GreaterEqual]: '>=',
  [CPP14Lexer.Assign]: '=',
};

/** Each default-channel token as `text@line:column`, with the operators named by type. */
const tokens = (
  code: string,
  lexer: new (input: ANTLRInputStream) => CPP14Lexer = ShiftAssignLexer
): string[] =>
  new lexer(new ANTLRInputStream(code))
    .getAllTokens()
    .filter((token: Token) => token.channel === Token.DEFAULT_CHANNEL)
    .map(
      (token: Token) =>
        `${NAMES[token.type] ?? token.text}@${token.line}:${token.charPositionInLine}`
    );

describe('ShiftAssignLexer', () => {
  it('splits the >= of a >>= into > and =, where they stand', () => {
    expect(tokens('y >>= 1;')).toEqual([
      'y@1:0',
      '>@1:2',
      '>@1:3',
      '=@1:4',
      '1@1:6',
      ';@1:7',
    ]);
  });

  it('is what unicoen lexed as > and >=', () => {
    expect(tokens('y >>= 1;', CPP14Lexer)).toEqual([
      'y@1:0',
      '>@1:2',
      '>=@1:3',
      '1@1:6',
      ';@1:7',
    ]);
  });

  it('keeps the offsets, so the text of the source is read back', () => {
    const code = 'int f(int y) {\n  y>>=2;\n  return y;\n}';
    const pieces = new ShiftAssignLexer(new ANTLRInputStream(code))
      .getAllTokens()
      .filter((token: Token) => token.text === '>' || token.text === '=');
    expect(pieces.map((token: Token) => [token.text, token.line])).toEqual([
      ['>', 2],
      ['>', 2],
      ['=', 2],
    ]);
    for (const token of pieces) {
      expect(code.slice(token.startIndex, token.stopIndex + 1)).toBe(
        token.text
      );
    }
  });

  it.each([
    ['a comparison', 'y >= 1', ['y@1:0', '>=@1:2', '1@1:5']],
    ['a right shift', 'y >> 1', ['y@1:0', '>@1:2', '>@1:3', '1@1:5']],
    ['a > and a >= apart', 'y > >= 1', ['y@1:0', '>@1:2', '>=@1:4', '1@1:7']],
    ['a <<=', 'y <<= 1', ['y@1:0', '<<=@1:2', '1@1:6']],
  ])('leaves %s alone', (_name, code, expected) => {
    expect(tokens(code)).toEqual(expected);
  });
});
