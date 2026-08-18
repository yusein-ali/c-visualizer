/**
 * What the preprocessor did to one span of the original source, so the editor
 * can show it. Types only - importing this pulls no code into the bundle, which
 * is why it does not live in `preprocess.ts` next to the pass that produces it.
 *
 * Positions are always in the source the user typed, never in the preprocessed
 * text; the pass preserves line numbers, but not columns.
 */
export type ExpansionKind =
  /** A macro use that was replaced by its expansion. */
  | 'macro'
  /** A line a conditional directive kept out of the compiled source. */
  | 'excluded'
  /** A directive line, which is removed and leaves a blank line behind. */
  | 'directive'
  /** An enumerator that was replaced by the integer it stands for. */
  | 'enum';

export interface Expansion {
  kind: ExpansionKind;
  /** 1-based line in the original source. */
  line: number;
  /** 0-based column where the replaced text starts. */
  column: number;
  /** Length of the replaced text, in characters of the original source. */
  length: number;
  /** Macro name, or the directive that excluded the line. */
  name: string;
  /** What the span became. Empty when the span was dropped. */
  text: string;
  /** Line of the directive that defined the macro, when there is one. */
  definedAt?: number;
  /**
   * For a conditional directive: whether the branch it opens is compiled.
   * Undefined for #endif and for directives that select nothing.
   */
  taken?: boolean;
}
