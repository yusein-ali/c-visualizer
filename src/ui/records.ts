/**
 * What PLIVET says about something, as data rather than as prose.
 *
 * Two surfaces read these: the editor's tooltip, which shows one at a time
 * for whatever the pointer is over, and the canvas's statement section, which
 * shows the ones belonging to the statement under the step marker. Neither
 * parses the other's text, and a fact added for one appears in the other -
 * which is the whole reason the record exists rather than a formatted string.
 *
 * They live here rather than in either widget because a widget that imported
 * the other could not be lifted out on its own, and this is the one thing the
 * two have to agree about.
 */

/**
 * One thing said about it.
 *
 * A fact with a label reads as a row of a table - `type`, `int` - and one
 * without a value is a sentence standing on its own, which is what a note
 * about the language is: "the body runs once before the first test" has no
 * left-hand column to put anything in.
 */
export interface Fact {
  label: string;
  value: string;
  /** Set where the value is program text and belongs in the monospace. */
  code?: boolean;
}

/** A headline and the facts under it. */
export interface Explanation {
  /** What this is: the name of a construct, or a variable and its value. */
  title: string;
  facts: Fact[];
  /**
   * The object it is about, where it is about one - the key every cell of
   * that object's row carries. It is what lets one panel light up what the
   * other is pointing at.
   */
  object?: string;
}

/**
 * What the statement under the step marker is doing, read as a whole.
 *
 * The tooltip answers one hover at a time; this is the same records gathered
 * for one statement - what kind of statement it is, which branch or which
 * iteration this is, what it leaves behind - with the parts of it that have
 * produced a value under that. Nothing here computes a second description of
 * a construct: a line the statement view wants and the tooltip has not is
 * added to the construct record, and both surfaces gain it.
 */
export interface StatementExplanation {
  statement: Explanation | null;
  /** A transition-specific context that replaces "currently executing". */
  context?: string;
  /** The subexpressions that have a value, in the order they are written. */
  parts: Explanation[];
}

export const emptyStatementExplanation = (): StatementExplanation => ({
  statement: null,
  parts: [],
});
