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

/** The parts of a C process the graph presents as distinct address spaces. */
export type MemoryRegion =
  | 'text'
  | 'readOnly'
  | 'data'
  | 'bss'
  | 'heap'
  | 'stack'
  | 'registers';

/**
 * A memory band shown by the JointJS renderer. Rows reuse the cells from the
 * compatible stack model above, so pointer keys still identify one object.
 */
export interface MemorySegmentModel {
  key: MemoryRegion;
  name: string;
  startAddress: number;
  rows: CellModel[][];
}

/** Fallback bases used when a segment has no live object in the current step. */
export const MEMORY_START_ADDRESSES: Record<MemoryRegion, number> = {
  registers: 0,
  text: 0x1000,
  readOnly: 0x2710,
  data: 0x3000,
  bss: 0x3800,
  heap: 0x4e20,
  stack: 0x10000,
};

/** A function occupies the text segment even though it is not a C object. */
export interface FunctionModel {
  name: string;
  address: number;
}

export type ExpressionNodeKind = 'operand' | 'operator' | 'assignment';

/** One evaluated part of the statement that completed at this step. */
export interface ExpressionNodeModel {
  key: string;
  kind: ExpressionNodeKind;
  text: string;
  /** `null` means this branch of a short-circuit/ternary was not evaluated. */
  value: string | null;
  /** Zero-based order in which the interpreter completed this node. */
  order: number;
  children: ExpressionNodeModel[];
}

export interface ExpressionModel {
  range: CodeRangeModel;
  root: ExpressionNodeModel;
}

/** An interpreter code range: one-based lines, zero-based columns. */
export interface CodeRangeModel {
  begin: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * A variable as the editor's tooltip says it: display types, display
 * addresses, and the value already spelled out. The tooltip runs on the main
 * thread and the interpreter runs in the Worker, so what it reads has to be
 * text by the time it arrives.
 */
export interface VariableModel {
  name: string;
  type: string;
  value: string;
  address: number;
  /** For a pointer, the variable it points at. */
  target?: { name: string; value: string };
}

export interface StepModel {
  stacks: StackModel[];
  pointers: PointerModel[];
  memory: MemorySegmentModel[];
  functions: FunctionModel[];
  /** The completed binary/ternary expression, including its assignment. */
  expression: ExpressionModel | null;
  /** Every variable in scope, innermost frame last. */
  variables: VariableModel[];
  /**
   * Where the next statement to execute is, which is what the editor
   * highlights and what a breakpoint is compared against.
   */
  codeRange: CodeRangeModel | null;
}

export const emptyStepModel = (): StepModel => ({
  stacks: [],
  pointers: [],
  memory: [],
  functions: [],
  expression: null,
  variables: [],
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
