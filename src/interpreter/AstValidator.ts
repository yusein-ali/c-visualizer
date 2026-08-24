import { UniBlock } from 'unicoen.ts/dist/node/UniBlock';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniProgram } from 'unicoen.ts/dist/node/UniProgram';

export interface AstValidationError {
  line: number;
  column: number;
  message: string;
}

/**
 * A line that opens a declaration. The same shape `syntaxErrorMessage` in
 * `core/server.ts` looks for, and for the same reason: it is what a statement
 * missing its semicolon looks like from the source rather than from the tree.
 */
const DECLARATION =
  /^(?:(?:const|volatile|static|extern|register|unsigned|signed|long|short)\s+)*(?:void|char|short|int|long|float|double|_Bool|bool|struct|enum|union|FILE)\b/;

/** A line the parser would have read as finished. */
const TERMINATED = /[;{}:,=+\-*/%<>&|^!?~[(\\]$/;

/** The line without a trailing `//` comment, and without trailing space. */
const statementText = (line: string): string =>
  line.replace(/\/\/.*$/, '').trimEnd();

/**
 * Where the missing semicolon belongs, read from the source rather than from
 * the tree.
 *
 * ANTLR's recovery keeps the token but throws its position away: the wrecked
 * statements around it arrive as bare `UniExpr` with a null `codeRange`, so
 * the innermost block that holds the stray token is the only coordinate the
 * tree still has, and that is its opening brace. Scanning the block's own
 * lines for the declaration nobody terminated puts the mark on the line the
 * reader has to edit. `used` keeps two strays in one block off the same line.
 */
const declarationWithoutSemicolon = (
  lines: string[],
  from: number,
  to: number,
  used: Set<number>
): AstValidationError | null => {
  for (let line = from; line <= to; line += 1) {
    const text = statementText(lines[line - 1] ?? '');
    const trimmed = text.trim();
    if (
      used.has(line) ||
      trimmed === '' ||
      trimmed.startsWith('#') ||
      !DECLARATION.test(trimmed) ||
      TERMINATED.test(trimmed)
    ) {
      continue;
    }
    used.add(line);
    return {
      line,
      column: text.length,
      message: "expected ';' after declaration",
    };
  }
  return null;
};

/**
 * Validate invariants required by the stepper after the permissive parser and
 * mapper have produced a UniCOEN tree.
 *
 * ANTLR can recover a missing delimiter and the mapper can leave the recovered
 * token in a statement list; that is not an executable statement and must not
 * reach the interpreter. `int a` with no semicolon is the case worth the pass:
 * the parser reports nothing at all for it, where the initialised `int a = 1`
 * raises `missing ';'` on its own.
 *
 * Three things it deliberately does not do, each of which reported a valid
 * program as broken - and a syntax error refuses the run in `Server.preflight`,
 * so a false one is not merely noise in the gutter:
 *
 * - It reads the entries of a statement list, never a node's string fields.
 *   Reading every string reported `printf(";")` and `char c = ';'`.
 * - It asks for the recovery debris before believing the token. A stray `;`
 *   in a statement list is not by itself a fault: `tour.h` leaves one in a
 *   perfectly good header. What only a recovered parse has is a wrecked
 *   sibling - a statement the mapper could not place, carrying no `codeRange`.
 * - It reports only what it can put a line on. The token's own position is
 *   gone, so an unplaceable one is dropped rather than marked on the enclosing
 *   brace, where it was both wrong and repeated once per stray token.
 */
export const validateAst = (
  program: UniProgram,
  source: string
): AstValidationError[] => {
  const errors: AstValidationError[] = [];
  const visited = new Set<UniNode>();
  const lines = source.split(/\r?\n/);
  const used = new Set<number>();

  const report = (block: UniBlock): void => {
    const strays = block.body.filter(
      (statement) => (statement as unknown) === ';'
    ).length;
    // A statement the mapper could not place. Every entry of a block the
    // parser read cleanly carries the range it came from.
    const recovered = block.body.some(
      (statement) =>
        statement instanceof UniNode && statement.codeRange === null
    );
    if (strays === 0 || !recovered) {
      return;
    }
    const range = block.codeRange;
    for (let stray = 0; stray < strays; stray += 1) {
      const located = declarationWithoutSemicolon(
        lines,
        range?.begin.y ?? 1,
        range?.end.y ?? lines.length,
        used
      );
      if (located === null) {
        return;
      }
      errors.push(located);
    }
  };

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
      return;
    }
    if (!(value instanceof UniNode) || visited.has(value)) {
      return;
    }
    visited.add(value);
    if (value instanceof UniBlock) {
      report(value);
    }
    for (const field of value.fields.keys()) {
      if (field === 'comments' || field === 'codeRange') {
        continue;
      }
      visit((value as unknown as Record<string, unknown>)[field]);
    }
  };

  visit(program);
  return errors;
};
