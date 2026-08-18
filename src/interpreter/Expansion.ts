/**
 * What the preprocessor did to one span of the original source, so the editor
 * can show it. Types only - importing this pulls no code into the bundle, which
 * is why it does not live in `preprocess.ts` next to the pass that produces it.
 *
 * Positions are always in the source the user typed, never in the preprocessed
 * text; the pass preserves line numbers, but not columns.
 */
export type ExpansionKind = 'macro' | 'excluded';

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
}
