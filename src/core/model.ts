/**
 * What one execution step looks like once the interpreter's own objects are
 * left behind: text, keys and numbers, and nothing else.
 *
 * This is the seam the rest of the port is built on. `extractModel` produces a
 * `StepModel` from an `ExecState`, `layout` turns one into geometry, and in
 * Phase 6 the model is what crosses the Worker boundary - so everything here
 * has to survive `structuredClone`. No class instances and no functions.
 */

/** The character size the cell widths below are measured in. */
export const CELL_FONT_SIZE = 17;
/** The height of every cell, and of a stack's header row. */
export const CELL_HEIGHT = 25;

/**
 * A cell is as wide as its text plus a margin. The margin alternates with the
 * parity of the length so that odd- and even-length texts do not end up the
 * same width; it is the rule the original canvas used and the layout is tuned
 * to it.
 */
export const cellWidth = (text: string): number => {
  const margin = text.length % 2 === 0 ? 1.5 : 1;
  return (text.length + 2 * margin) * (CELL_FONT_SIZE / 2);
};

export type CellKind =
  /** The variable's declared type, qualifiers included. */
  | 'type'
  | 'name'
  | 'value'
  | 'address'
  /** The triangle that shows and hides an aggregate's members. */
  | 'fold'
  /** The blank cell a member row is shifted right by. */
  | 'indent'
  /** Padding, added by the layout to square off a stack's columns. */
  | 'empty';

export interface CellModel {
  /**
   * Identifies the cell within a step. Pointers are resolved to keys, so a key
   * is what an arrow connects; the layout looks cells up by it.
   */
  key: string;
  text: string;
  kind: CellKind;
  /** The cell's own width. The layout widens it to square off a column. */
  width: number;
  /** For a pointer's value cell: the key of the cell it points at. */
  pointerTarget?: string;
  /** The innermost fold group this cell belongs to, if any. */
  foldGroup?: string;
  /** For a `fold` cell: the group it shows and hides. */
  foldTarget?: string;
}

export interface StackModel {
  key: string;
  name: string;
  rows: CellModel[][];
}

export interface PointerModel {
  /** The key of the value cell holding the address. */
  from: string;
  /** The key of the address cell it names. */
  to: string;
}

/** An interpreter code range: one-based lines, zero-based columns. */
export interface CodeRangeModel {
  begin: { x: number; y: number };
  end: { x: number; y: number };
}

export interface StepModel {
  stacks: StackModel[];
  pointers: PointerModel[];
  /**
   * Where the next statement to execute is, which is what the editor
   * highlights and what a breakpoint is compared against.
   */
  codeRange: CodeRangeModel | null;
}

export const emptyStepModel = (): StepModel => ({
  stacks: [],
  pointers: [],
  codeRange: null,
});

/**
 * Fold groups nest - an array of structs folds inside an array of arrays - and
 * a group is named by the path of keys that reaches it, so that a folded group
 * can be recognised as an ancestor of a row by a prefix test alone. The
 * separator is a character no key can contain.
 */
const FOLD_SEPARATOR = '\u0001';

export const foldGroupOf = (parent: string | undefined, key: string): string =>
  `${parent === undefined ? '' : parent}${FOLD_SEPARATOR}${key}`;

/** Whether `group` is `folded` itself or lies inside it. */
export const isWithinFold = (
  group: string | undefined,
  folded: string
): boolean =>
  group !== undefined &&
  (group === folded || group.startsWith(`${folded}${FOLD_SEPARATOR}`));
