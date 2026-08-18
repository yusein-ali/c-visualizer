/**
 * A statement or expression the parser recognised, with where it sits in the
 * source, so the editor can say what a line is. This module holds the type and
 * the rule for choosing between overlapping constructs, and nothing else - the
 * walk that produces them lives in `outline.ts`, inside the interpreter chunk.
 *
 * `kind` is a stable key the editor translates; it is not the parser's class
 * name, so the wording can change without touching the AST walk.
 */
export interface Construct {
  kind: string;
  /** The declared type, the called name - whatever makes the kind concrete. */
  detail: string;
  /** 1-based line, 0-based column, as the parser reports them. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/**
 * The construct to describe at a position, or null.
 *
 * A construct answers only for the line it opens on or the line it closes on.
 * Its range covers everything it contains, so without that rule a hover in the
 * middle of a loop body reports the loop - the reader is asking about the line
 * under the cursor, not the block around it. On a line that opens and closes
 * several, the innermost wins.
 */
export function constructAt(
  constructs: Construct[],
  line: number,
  column: number
): Construct | null {
  const size = (c: Construct) =>
    (c.endLine - c.line) * 1000 + (c.endColumn - c.column);
  let found: Construct | null = null;
  for (const construct of constructs) {
    const opensHere = construct.line === line && construct.column <= column;
    const closesHere =
      construct.endLine === line && column <= construct.endColumn;
    const matches =
      construct.line === construct.endLine
        ? opensHere && closesHere
        : opensHere || closesHere;
    if (matches && (found === null || size(construct) < size(found))) {
      found = construct;
    }
  }
  return found;
}
