import { CPP14Lexer } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Lexer';
import type { Token } from 'antlr4ts';

/**
 * unicoen's C++14 lexer, handing `>>=` to the parser in the pieces its
 * grammar asks for.
 *
 * The grammar has no `>>` or `>>=` token, so that the `>>` closing two
 * template argument lists (`vector<vector<int>>`) can be read as two `>`. A
 * right shift is the rule `rightShift: '>' '>'` and its assignment the rule
 * `rightShiftAssign: '>' '>' '='` - but the lexer takes the longest token it
 * can, and reads `>>=` as `>` and `>=`. No rule takes that pair, so the
 * statement did not parse, ANTLR recovered by dropping it, and `y >>= 1` ran
 * as if it were not there. Splitting a `>=` that directly follows a `>` into
 * `>` and `=` gives the rule its three tokens. The mapper joins them back into
 * the operator `>>=`, which the engine's compound assignment computes like any
 * other.
 *
 * Only a `>=` that touches the `>` before it is split: `a > >= b` is not C,
 * and stays an error. The two tokens keep the offsets, line and columns of
 * the source, so every position the editor shows is unchanged.
 */
export class ShiftAssignLexer extends CPP14Lexer {
  /** The `=` of a split `>=`, returned by the next call. */
  private pending: Token | null = null;
  /** The token returned last, whatever its channel. */
  private previous: Token | null = null;

  /**
   * The channels' names, which antlr4ts declares abstract and unicoen's
   * lexer, generated before it did, does not define. These are the two
   * channels every lexer has; this grammar sends nothing to a third.
   */
  get channelNames(): string[] {
    return ['DEFAULT_TOKEN_CHANNEL', 'HIDDEN'];
  }

  nextToken(): Token {
    const pending = this.pending;
    if (pending !== null) {
      this.pending = null;
      this.previous = pending;
      return pending;
    }
    const token = super.nextToken();
    const previous = this.previous;
    this.previous = token;
    if (
      token.type !== CPP14Lexer.GreaterEqual ||
      previous === null ||
      previous.type !== CPP14Lexer.Greater ||
      previous.stopIndex + 1 !== token.startIndex
    ) {
      return token;
    }
    const piece = (type: number, text: string, offset: number): Token =>
      this.tokenFactory.create(
        this._tokenFactorySourcePair,
        type,
        text,
        token.channel,
        token.startIndex + offset,
        token.startIndex + offset,
        token.line,
        token.charPositionInLine + offset
      );
    const greater = piece(CPP14Lexer.Greater, '>', 0);
    this.pending = piece(CPP14Lexer.Assign, '=', 1);
    this.previous = greater;
    return greater;
  }
}
