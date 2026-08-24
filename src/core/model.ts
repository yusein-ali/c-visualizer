/**
 * What one execution step looks like once the interpreter's own objects are
 * left behind: text, keys and numbers, and nothing else.
 *
 * This is the seam the rest of the port is built on. `extractModel` produces a
 * `StepModel` from an `ExecState`, `layout` turns one into geometry, and the
 * model is what crosses the Worker boundary - so everything here
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
  /** Optional presentation cap: this cell may be shortened, but not widened. */
  maxWidth?: number;
  /** For a pointer's value cell: the key of the cell it points at. */
  pointerTarget?: string;
  /**
   * For an `address` cell: the address itself, as a number. The cell's text
   * spells it the way the stack table wants it (`&x(0x1F4) `); the memory view
   * wants an address column, and re-parsing the text to get one back would be
   * silly.
   */
  address?: number;
  /** For a `type` cell: how many bytes the object occupies. */
  size?: number;
  /**
   * The object this cell is part of - every cell of one variable's row
   * carries the same one. It is what lets a tooltip in the editor and a row
   * on the canvas be recognised as two pictures of the same object, which is
   * a question neither side can answer from a cell key alone: a key names one
   * cell, and an object is a row of them.
   */
  object?: string;
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
 * A run of consecutive rows that belong together inside a segment: the stack
 * is the frames of the functions currently running, and a memory view that
 * does not say where one frame ends and the next begins is not showing the
 * stack, only the variables that happen to be on it.
 */
export interface MemoryGroupModel {
  name: string;
  /** How many of the segment's rows, from where the previous group ended. */
  rows: number;
  /**
   * What the reader's decision to fold this group is filed under. It has to
   * outlive the step: a frame the reader put away stays away while the
   * program runs inside it, and rebuilding the model every step would
   * otherwise open it again.
   */
  key: string;
  /** Whether this is the frame the program is executing in. */
  current: boolean;
}

/**
 * A memory band shown by the JointJS renderer. Rows reuse the cells from the
 * compatible stack model above, so pointer keys still identify one object.
 */
export interface MemorySegmentModel {
  key: MemoryRegion;
  name: string;
  startAddress: number;
  rows: CellModel[][];
  /** Ordered spans over `rows`. Empty when the segment has no substructure. */
  groups: MemoryGroupModel[];
}

/**
 * What every segment, and every object the visualization places itself, starts
 * on. The engine packs its own storage as C does - a `char` takes one byte and
 * the next one sits beside it - but a band of memory begins on a word.
 */
export const MEMORY_ALIGNMENT = 4;

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

/**
 * The bands holding what the program was loaded with rather than what it is
 * doing: the code it runs, and the constants and string literals beside it.
 * Neither changes as the program runs.
 */
const STATIC_REGIONS: ReadonlySet<MemoryRegion> = new Set<MemoryRegion>([
  'readOnly',
  'text',
]);

/**
 * Whether a segment nobody has clicked is drawn as its title bar alone. One
 * holding nothing has no table worth the room. The static bands have one, and
 * it is the same table at every step: a reader stepping through a program is
 * watching the stack move, not re-reading the literals, so these open on a
 * click rather than on the first step.
 */
export const startsCollapsed = (
  region: MemoryRegion,
  empty: boolean
): boolean => empty || STATIC_REGIONS.has(region);

/**
 * The bands a memory map names whatever they hold: the two the program was
 * loaded with, and the two a reader steps through it to watch. A stack that
 * appears at the first call and a heap that appears at the first `malloc`
 * teach that the band was not there to begin with; an empty one, named and put
 * away, says where the frames and the allocations will land before the program
 * has put anything in them.
 */
const ALWAYS_SHOWN: ReadonlySet<MemoryRegion> = new Set<MemoryRegion>([
  ...STATIC_REGIONS,
  'stack',
  'heap',
]);

/**
 * Whether a region nobody has switched is on the canvas at all. A band holding
 * nothing is left off until the reader asks for it, unless it is one of the
 * four the map always names - and those arrive as a title bar alone, because
 * `startsCollapsed` puts an empty segment away rather than spend a table on a
 * row saying it is empty.
 */
export const startsShown = (region: MemoryRegion, holds: boolean): boolean =>
  holds || ALWAYS_SHOWN.has(region);

/** One argument a call passed, beside the parameter it initialised. */
export interface FrameArgumentModel {
  /** The parameter's name, or empty where the callee is not the program's. */
  name: string;
  value: string;
}

/**
 * One function the run is inside: a frame of the call stack, as a reader
 * reads one.
 *
 * The memory map already draws the frames as bands of storage. This is the
 * other question a reader asks of a stack - who called whom, from where, with
 * what - and it is not a question about memory: the answer is in the calls,
 * not in the bytes they left behind.
 */
export interface FrameModel {
  name: string;
  /** 1-based line the function is defined on. */
  line: number;
  /** The line containing the call; null for the initial function invocation. */
  calledFrom: number | null;
  /** The source file containing the call, when the application has mapped it. */
  calledFromFile?: string;
  /** What it was passed, in order, spelled as C passed it: by value. */
  arguments: FrameArgumentModel[];
  /** How many times it has been entered so far, this activation included. */
  timesEntered: number;
}

/**
 * One write the run has made, kept after the step that made it.
 *
 * Every other view says what memory holds now. This one says what it held
 * before, which is the question a reader asks when a value is wrong and they
 * are looking for the statement that made it wrong - and across calls, which
 * is where C's by-value argument passing surprises people. The named frame
 * distinguishes a write to a parameter object from a write through a pointer
 * to an object whose lifetime began in a caller.
 */
export interface MutationModel {
  /** The object as the source names it: `total`, `arr[2]`, `*p`. */
  target: string;
  /** The function whose frame the write happened in. */
  frame: string;
  before: string;
  after: string;
  /** 1-based line of the assignment. */
  line: number;
}

/** A function occupies the text segment even though it is not a C object. */
export interface FunctionModel {
  name: string;
  address: number;
  /** Illustrative size of the compiled code in bytes. */
  size: number;
}

export type ExpressionNodeKind = 'operand' | 'operator' | 'assignment';

/** One evaluated part of the statement that completed at this step. */
export interface ExpressionNodeModel {
  key: string;
  kind: ExpressionNodeKind;
  text: string;
  /**
   * Where the operand or operator is written. The canvas does not need it; the
   * tooltip does, so that hovering inside a compound expression can answer
   * about the innermost part under the pointer rather than the whole line.
   */
  range: CodeRangeModel;
  /**
   * What the node is worth going into the step: an operand's current value, or
   * an operator's result once it has one. `null` until then.
   */
  value: string | null;
  /**
   * The parameter this node initialises, set only on the direct arguments of a
   * call and only where the program defines the callee. It is what pairs an
   * argument with the object it is copied into, which is the one thing a tree
   * of operators cannot say on its own.
   */
  parameter?: string;
  children: ExpressionNodeModel[];
}

export interface ExpressionModel {
  range: CodeRangeModel;
  root: ExpressionNodeModel;
}

/**
 * One call in the statement about to run, drawn with its arguments.
 *
 * The statement's own tree already contains the call, so this is not new
 * information - it is the call on its own, away from whatever surrounds it.
 * `total = total + twice(a * 2 + 1)` puts the argument three levels down a
 * tree rooted at an assignment, where the question C's by-value passing raises
 * - what value was actually copied into the parameter - is the hardest thing
 * on the canvas to read.
 *
 * The unit is the call, not the argument. Arguments are what one call operator
 * binds, in one go, positionally: pulling them apart into a view each would
 * separate them from the operator that gives them their meaning and from each
 * other. So the tree here is rooted at the call, its arguments beneath it,
 * each tagged with the parameter it fills.
 */
export interface CallExpansionModel {
  /**
   * Stable across steps for one call site, so a reader who collapses a section
   * keeps it collapsed as the program moves.
   */
  key: string;
  /** The function being called, as `twice()`. */
  callee: string;
  /**
   * The parameters it binds, in order. Empty where the callee cannot be
   * resolved without running the program - a library function, or a call
   * through a function pointer - and the view then names positions alone.
   */
  parameters: string[];
  /** The call operator with its arguments under it. */
  expression: ExpressionModel;
}

/** An interpreter code range: one-based lines, zero-based columns. */
export interface CodeRangeModel {
  begin: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Whether a position falls inside a range the interpreter reported.
 *
 * The end column of an expression is one past its last character - `n * 2` in
 * `return n * 2;` ends at the semicolon's column - so the comparison is strict
 * at that end and the trailing punctuation stays outside. Both the tooltip and
 * the canvas ask this question of the same ranges, which is why the answer
 * lives here rather than once on each side.
 */
export const rangeCovers = (
  range: CodeRangeModel,
  line: number,
  column: number
): boolean =>
  (range.begin.y < line ||
    (range.begin.y === line && range.begin.x <= column)) &&
  (line < range.end.y || (range.end.y === line && column < range.end.x));

/** How much a range covers, for choosing the smallest of several. */
export const rangeSpan = (range: CodeRangeModel): number =>
  (range.end.y - range.begin.y) * 1000 + (range.end.x - range.begin.x);

/**
 * What one part of the statement came to.
 *
 * `ExpressionModel` above is the statement *about to* run - structure, and
 * what its names hold going in - because that is what the marker is on. These
 * are the values the operators themselves produced, which only exist once the
 * statement has run, and they are what lets a tooltip answer about the `*` in
 * `total = a * b + c` rather than about the whole assignment.
 */
export interface EvaluationModel {
  range: CodeRangeModel;
  value: string;
}

/** One thing that is true about a construct at this step, and its name. */
export interface ConstructFactModel {
  /** A key in `strings.ts`: `factCondition`, `factIterations`, … */
  label: string;
  value: string;
}

/**
 * What a construct is doing at this step.
 *
 * Only the constructs the step is inside are here: the statement about to run,
 * the loops and the switch around it, and the calls that are still on the
 * stack. That is exactly the set a runtime line may be shown for - a tooltip
 * never says what a loop did on a step the reader is not on, and a stopped
 * session says nothing at all.
 */
export interface ConstructStateModel {
  range: CodeRangeModel;
  /** The construct kind, the same key `Construct.kind` uses. */
  kind: string;
  facts: ConstructFactModel[];
}

/**
 * A variable as the editor's tooltip says it: display types, display
 * addresses, and the value already spelled out. The tooltip runs on the main
 * thread and the interpreter runs in the Worker, so what it reads has to be
 * text by the time it arrives.
 */
export interface VariableModel {
  name: string;
  /**
   * The object key its cells carry, so the canvas can be asked to select the
   * row this tooltip is describing. Built the same way `extractModel` builds
   * it, out of the frame and the name.
   */
  key: string;
  type: string;
  value: string;
  address: number;
  /** The implementation-model memory band holding this object. */
  region: MemoryRegion;
  /** The interpreter frame that owns it (`GLOBAL` for file-scope objects). */
  frame: string;
  /** Whether its function frame is the one currently executing. */
  active: boolean;
  /**
   * How many bytes it occupies, as the display layout counts them. Absent for
   * an object the layout has no size for, which the table says as a dash.
   */
  size?: number;
  /** For a pointer, the variable it points at. */
  target?: { name: string; value: string };
}

/** The source and function whose next statement is being shown. */
export interface StepContextModel {
  /** The visible source path, filled when the composed source is mapped back. */
  file: string | null;
  /** The innermost active function, or null before/after execution. */
  function: string | null;
}

/**
 * A variable the statement about to run reads or assigns, and what it holds
 * going into that statement. The editor prints these at the end of the line it
 * has stopped on, which is the one place a reader is already looking.
 */
export interface InlineValueModel {
  name: string;
  /** The value, spelled as the tooltip spells it. */
  display: string;
}

/**
 * How many of them the line is allowed. A statement that mentions more objects
 * than this has stopped being readable at the end of a line, and the canvas is
 * the thing that shows a whole frame.
 */
export const INLINE_VALUE_LIMIT = 6;

export interface StepModel {
  stacks: StackModel[];
  pointers: PointerModel[];
  memory: MemorySegmentModel[];
  functions: FunctionModel[];
  /** The current expression expanded into operands and operators. */
  expression: ExpressionModel | null;
  /** The calls in it that pass a computed argument, each with its arguments. */
  callExpansions: CallExpansionModel[];
  /** Every variable in scope, innermost frame last. */
  variables: VariableModel[];
  /** The file and function context that gives those variables meaning. */
  context: StepContextModel;
  /** What the statement about to run reads or assigns, in source order. */
  inlineValues: InlineValueModel[];
  /** What the constructs the step is inside are doing, for the tooltips. */
  constructStates: ConstructStateModel[];
  /** The functions the run is inside, outermost first. */
  frames: FrameModel[];
  /** Every write the run has made up to this step, oldest first. */
  mutations: MutationModel[];
  /** What the parts of the statement the step just finished came to. */
  evaluations: EvaluationModel[];
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
  callExpansions: [],
  variables: [],
  context: { file: null, function: null },
  inlineValues: [],
  constructStates: [],
  frames: [],
  mutations: [],
  evaluations: [],
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

/**
 * Every group on the way down to this one, outermost first, ending with the
 * group itself.
 *
 * A row is hidden by a fold anywhere above it, and an aggregate that nobody
 * has clicked is folded - so the question is no longer "which groups did the
 * reader close" but "is anything on this row's path closed", and the path is
 * what a group's own name spells out.
 */
export const foldPathOf = (group: string): string[] =>
  group
    .split(FOLD_SEPARATOR)
    .slice(1)
    .map((_part, index, parts) =>
      parts
        .slice(0, index + 1)
        .reduce((path, key) => `${path}${FOLD_SEPARATOR}${key}`, '')
    );
