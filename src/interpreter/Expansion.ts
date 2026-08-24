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
  /**
   * Whether a directive is inside an active conditional-inclusion region.
   * Conditional control lines themselves are active when their enclosing
   * group is active, even when the branch they select is not taken.
   * Undefined for non-directive expansions.
   */
  active?: boolean;
  /**
   * What the macro's own replacement list put there, before any macro inside
   * it was expanded in turn. `text` is the end of that chain; this is the step
   * that leads to it, and it is only recorded when the two differ - a macro
   * defined in terms of another otherwise has to be unfolded by hand.
   */
  replacement?: string;
  /** Line of the directive that defined the macro, when there is one. */
  definedAt?: number;
  /**
   * For a conditional directive: whether the branch it opens is compiled.
   * Undefined for #endif and for directives that select nothing.
   */
  taken?: boolean;
}

/** A range carrying the coordinates emitted by the interpreter. */
export interface PreprocessedRange {
  begin: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Maps one column in preprocessed text back to the source the reader wrote.
 *
 * Macro replacement preserves lines but may change their width. A point
 * inside replacement text has no narrower source equivalent, so either end
 * of a range expands to cover the complete macro invocation.
 */
const originalColumn = (
  line: number,
  column: number,
  edge: 'begin' | 'end',
  expansions: Expansion[]
): number => {
  let drift = 0;
  const macros = expansions
    .filter(
      (expansion) =>
        expansion.kind === 'macro' &&
        expansion.line === line &&
        !expansion.text.includes('\n')
    )
    .sort((left, right) => left.column - right.column);

  for (const expansion of macros) {
    const processedFrom = expansion.column + drift;
    const processedTo = processedFrom + expansion.text.length;
    if (column < processedFrom) {
      break;
    }
    if (processedFrom <= column && column < processedTo) {
      return edge === 'begin'
        ? expansion.column
        : expansion.column + Math.max(expansion.length - 1, 0);
    }
    drift += expansion.text.length - expansion.length;
  }
  return column - drift;
};

/**
 * Restores the original columns of an inclusive interpreter source range.
 * Expansion records themselves already use original coordinates; this is for
 * ranges produced by parsing the replaced text.
 */
export const originalRange = (
  range: PreprocessedRange,
  expansions: Expansion[]
): PreprocessedRange => ({
  begin: {
    x: originalColumn(range.begin.y, range.begin.x, 'begin', expansions),
    y: range.begin.y,
  },
  end: {
    x: originalColumn(range.end.y, range.end.x, 'end', expansions),
    y: range.end.y,
  },
});
