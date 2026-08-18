/**
 * A statement or expression the parser recognised, with where it sits in the
 * source, so the editor can say what a line is. Types only - importing this
 * pulls no code into the bundle.
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
