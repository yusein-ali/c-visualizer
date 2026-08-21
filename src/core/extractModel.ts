import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Stack } from 'unicoen.ts/dist/interpreter/Engine/Stack';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { RuntimeDeclarationInfo } from '../interpreter/DeclarationSpecifiers';
import type { RuntimeStringLiteral } from '../interpreter/RuntimeTypeInfo';
import {
  constructStatesOf,
  evaluationsOf,
  framesOf as callFramesOf,
  mutationsOf,
} from '../interpreter/ConstructTrace';
import { expressionTraceOf } from '../interpreter/ExpressionTrace';
import { statementNames } from '../interpreter/StatementNames';
import {
  declarationInfoOf,
  displayAddressOf,
  displayPointerValueOf,
  displaySizeOf,
  displayTypeOf,
  enumInfoOf,
  functionPointerInfoOf,
  runtimeFunctionsOf,
  runtimeStringsOf,
} from '../interpreter/RuntimeTypeInfo';
import {
  CellModel,
  CodeRangeModel,
  ExpressionModel,
  ExpressionNodeModel,
  FunctionModel,
  INLINE_VALUE_LIMIT,
  InlineValueModel,
  MEMORY_START_ADDRESSES,
  MemoryRegion,
  MemoryGroupModel,
  MemorySegmentModel,
  PointerModel,
  StackModel,
  StepModel,
  VariableModel,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
} from './model';
import { extractVariables, formatAddress, narrowToType } from './variables';

/**
 * Reading an execution state as text.
 *
 * This is the half of the old `CanvasDrawer` that knows about the interpreter,
 * and it now knows about nothing else: it walks stacks and variables, spells
 * each one the way the visualization shows it, and resolves every pointer to
 * the key of the cell it points at. Where those cells end up on screen is the
 * layout's problem, and in Phase 6 this runs in the Worker while the layout
 * stays on the main thread.
 */

/**
 * Spells the declaration back the way it was written: storage classes and
 * qualifiers in front of the type, and each pointer level's own qualifiers
 * after its star.
 */
function qualifiedDisplayType(
  displayType: string,
  declaration: RuntimeDeclarationInfo | null
): string {
  if (declaration === null) {
    return displayType;
  }
  // Only the trailing run counts. A function pointer spells its own star
  // inside the declarator - `int (*)(int, int)` - and appending another would
  // make it a pointer to a function pointer.
  const trailing = /\s*(\*+)\s*$/.exec(displayType);
  const stars = trailing === null ? 0 : trailing[1].length;
  const baseType = displayType.replace(/\s*\*+\s*$/, '').trim();
  let baseQualifiers =
    declaration.baseQualifiers === undefined
      ? declaration.qualifiers
      : declaration.baseQualifiers;
  if (
    stars === 0 &&
    baseQualifiers.length === 0 &&
    (declaration.pointerQualifiers || []).length > 0
  ) {
    // A qualifier applied to a pointer typedef is spelled before the alias
    // even though semantically it binds the typedef's outer pointer.
    baseQualifiers = declaration.qualifiers;
  }
  let result = [
    ...declaration.storageClasses,
    ...baseQualifiers,
    baseType,
  ].join(' ');
  const pointerQualifiers = declaration.pointerQualifiers || [];
  for (let level = 0; level < stars; level += 1) {
    result += ' *';
    const qualifiers = pointerQualifiers[level] || [];
    if (qualifiers.length > 0) {
      result += ` ${qualifiers.join(' ')}`;
    }
  }
  return result;
}

/**
 * Collects the two address tables while the stacks are walked, and turns them
 * into pointer connections once every variable has been seen. A pointer can
 * name an address declared later in the same step, so nothing can be resolved
 * before the walk is over.
 */
class AddressTable {
  /** Address of every variable, against the key of its address cell. */
  private readonly targets = new Map<number, string>();
  /** Address held by a pointer, against the keys of the cells holding it. */
  private readonly sources = new Map<number, string[]>();
  private readonly valueCells = new Map<string, CellModel>();

  public declare(address: number, cellKey: string): void {
    this.targets.set(address, cellKey);
  }

  public points(address: number, cell: CellModel): void {
    const existing = this.sources.get(address);
    if (existing === undefined) {
      this.sources.set(address, [cell.key]);
    } else {
      existing.push(cell.key);
    }
    this.valueCells.set(cell.key, cell);
  }

  /**
   * The connections, and the `pointerTarget` on each pointer's value cell.
   * A pointer into memory no variable declares - a null pointer, or one past
   * the end of an array - simply has no connection.
   */
  public resolve(): PointerModel[] {
    const pointers: PointerModel[] = [];
    for (const [address, fromKeys] of this.sources) {
      const to = this.targets.get(address);
      if (to === undefined) {
        continue;
      }
      for (const from of fromKeys) {
        pointers.push({ from, to });
        const cell = this.valueCells.get(from);
        if (cell !== undefined) {
          cell.pointerTarget = to;
        }
      }
    }
    return pointers;
  }
}

type Typedef = (type: string) => string;

const cell = (
  text: string,
  parentKey: string,
  kind: CellModel['kind'],
  foldGroup?: string
): CellModel => {
  const model: CellModel = {
    // Keys are built the way the canvas built them, out of the parent's key
    // and the cell's own text.
    key: `${parentKey}-${text}`,
    text,
    kind,
    width: cellWidth(text),
    // The parent key names the object rather than the cell: every cell of one
    // variable's row carries it, which is how a row is recognised as a whole.
    object: parentKey,
  };
  if (foldGroup !== undefined) {
    model.foldGroup = foldGroup;
  }
  return model;
};

/** How a scalar variable's value is spelled. */
function valueTextOf(variable: Variable, getTypedef: Typedef): string {
  const { type } = variable;
  const value = variable.getValue();
  let valueStr =
    value === null || typeof value === 'undefined'
      ? 'uninitialized'
      : value.toString();
  // The engine computes in JavaScript numbers; the row is about an object of a
  // declared width, and has to say what that width can hold.
  if (value !== null && typeof value !== 'undefined') {
    const raw = value.valueOf();
    if (typeof raw === 'number') {
      const held = narrowToType(raw, getTypedef(type));
      if (held !== null) {
        valueStr = String(held);
      }
    }
  }
  const enumInfo = enumInfoOf(variable);
  const functionInfo = functionPointerInfoOf(variable);

  if (functionInfo !== null && value != null) {
    // A function pointer holds an address like any other pointer, so it is
    // shown like one; the name is what makes the address mean something.
    const hex = formatAddress(Number(value.valueOf()));
    valueStr =
      functionInfo.pointee === null ? hex : `${functionInfo.pointee} (${hex})`;
  }
  if (enumInfo !== null && enumInfo.scalar) {
    const names = enumInfo.namesByValue[String(value.valueOf())];
    if (typeof names !== 'undefined') {
      valueStr = `${names.join(' / ')} (${valueStr})`;
    }
  }

  const rawType = getTypedef(type);
  if (functionInfo === null && rawType.indexOf('*') !== -1 && value != null) {
    const pointerValue = displayPointerValueOf(variable);
    valueStr = formatAddress(pointerValue === null ? value : pointerValue);
  }
  if (rawType === 'char' && value != null) {
    valueStr += ` '${String.fromCharCode(Number(value.valueOf()) & 0xff)}'`;
  }
  return valueStr;
}

/** A scalar variable: one row of type, name, value and address. */
function scalarRows(
  variable: Variable,
  parentKey: string,
  foldGroup: string | undefined,
  getTypedef: Typedef,
  addresses: AddressTable
): CellModel[][] {
  const key = `${parentKey}-${variable.name}`;
  const { name, type } = variable;
  const value = variable.getValue();
  const address = displayAddressOf(variable);
  const functionInfo = functionPointerInfoOf(variable);

  const typeCell = cell(
    qualifiedDisplayType(displayTypeOf(variable), declarationInfoOf(variable)),
    key,
    'type',
    foldGroup
  );
  const size = displaySizeOf(variable);
  if (size !== null) {
    typeCell.size = size;
  }
  const nameCell = cell(name, key, 'name', foldGroup);
  const valueCell = cell(
    valueTextOf(variable, getTypedef),
    key,
    'value',
    foldGroup
  );
  const addressCell = cell(
    `&${name}(${formatAddress(address)}) `,
    key,
    'address',
    foldGroup
  );
  addressCell.address = address;

  if (functionInfo === null && getTypedef(type).indexOf('*') !== -1) {
    // The value is an address, and the cell showing it is where the arrow
    // starts.
    const pointerValue = displayPointerValueOf(variable);
    addresses.points(pointerValue === null ? value : pointerValue, valueCell);
  } else if (functionInfo !== null && value != null) {
    addresses.points(Number(value.valueOf()), valueCell);
  }
  addresses.declare(address, addressCell.key);

  return [[typeCell, nameCell, valueCell, addressCell]];
}

/**
 * An aggregate - an array, a struct or a union - as its own row followed by
 * its members, each shifted one cell right and carrying the fold group the
 * triangle on the aggregate's row shows and hides.
 */
function aggregateRows(
  variable: Variable,
  parentKey: string,
  foldGroup: string | undefined,
  getTypedef: Typedef,
  addresses: AddressTable
): CellModel[][] {
  const key = `${parentKey}-${variable.name}`;
  const { name } = variable;
  const address = displayAddressOf(variable);
  const group = foldGroupOf(foldGroup, key);

  const typeCell = cell(
    qualifiedDisplayType(displayTypeOf(variable), declarationInfoOf(variable)),
    key,
    'type',
    foldGroup
  );
  const aggregateSize = displaySizeOf(variable);
  if (aggregateSize !== null) {
    typeCell.size = aggregateSize;
  }
  const nameCell = cell(name, key, 'name', foldGroup);
  // An aggregate holds its own address: the arrow from it points at itself,
  // which is what shows that the name and the storage are the same thing.
  const valueCell = cell(formatAddress(address), key, 'value', foldGroup);
  const addressCell = cell(`&${name}(SYSTEM)`, key, 'address', foldGroup);
  addressCell.address = address;
  // The triangle itself is the layout's to draw: which way it points is fold
  // state, and fold state is not part of the model. The cell is as wide as the
  // one character that will go in it.
  const foldCell: CellModel = {
    key: `${key}-fold`,
    text: '',
    kind: 'fold',
    width: cellWidth(' '),
    object: key,
    foldTarget: group,
  };
  if (foldGroup !== undefined) {
    foldCell.foldGroup = foldGroup;
  }
  addresses.points(address, valueCell);

  const members: CellModel[][] = [];
  const value: Variable[] = variable.getValue();
  for (const member of value) {
    for (const row of variableRows(member, key, group, getTypedef, addresses)) {
      const indent = cell(
        '',
        `${key}-empty-${members.length}`,
        'indent',
        group
      );
      members.push([indent, ...row]);
    }
  }

  return [[typeCell, nameCell, valueCell, addressCell, foldCell], ...members];
}

function variableRows(
  variable: Variable,
  parentKey: string,
  foldGroup: string | undefined,
  getTypedef: Typedef,
  addresses: AddressTable
): CellModel[][] {
  return Array.isArray(variable.getValue())
    ? aggregateRows(variable, parentKey, foldGroup, getTypedef, addresses)
    : scalarRows(variable, parentKey, foldGroup, getTypedef, addresses);
}

function stackModel(
  stack: Stack,
  getTypedef: Typedef,
  addresses: AddressTable,
  memory: MemoryCollector
): StackModel {
  const rows: CellModel[][] = [];
  for (const variable of stack.getVariables()) {
    const variableModel = variableRows(
      variable,
      stack.name,
      undefined,
      getTypedef,
      addresses
    );
    rows.push(...variableModel);
    memory.add(variable, stack.name, variableModel);
  }
  return { key: stack.name, name: stack.name, rows };
}

interface MemoryEntry {
  address: number;
  engineAddress: number;
  rows: CellModel[][];
  synthetic: boolean;
  /** The stack frame the object was declared in, for the stack's groups. */
  owner: string;
}

const MEMORY_ORDER: MemoryRegion[] = [
  'registers',
  'text',
  'readOnly',
  'data',
  'bss',
  'heap',
  'stack',
];

/**
 * The frames the stack segment's rows fall into, as spans: consecutive
 * entries declared in the same frame are one group, so `main` and the
 * function it called are told apart in a segment that is otherwise one list.
 */
function framesOf(entries: MemoryEntry[]): MemoryGroupModel[] {
  const groups: MemoryGroupModel[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (typeof last !== 'undefined' && last.name === entry.owner) {
      last.rows += entry.rows.length;
    } else {
      groups.push({ name: entry.owner, rows: entry.rows.length });
    }
  }
  return groups;
}

/** Separates live variables without changing the compatible stack model. */
class MemoryCollector {
  private readonly entries = new Map<MemoryRegion, MemoryEntry[]>();

  add(variable: Variable, stackName: string, rows: CellModel[][]): void {
    const region = memoryRegionOf(variable, stackName);
    const entries = this.entries.get(region) || [];
    entries.push({
      address: displayAddressOf(variable),
      engineAddress: variable.address,
      rows,
      synthetic: /^(Static|Heap):/.test(variable.name),
      owner: stackName,
    });
    this.entries.set(region, entries);
  }

  /**
   * The string literals, as the read-only objects they are. They have no name
   * in C, so the text they hold stands in for one; what a reader wants to see
   * is that `"hi"` occupies three bytes somewhere a `const char *` can point
   * at, and which pointer is pointing there.
   */
  addStrings(literals: RuntimeStringLiteral[], addresses: AddressTable): void {
    const entries = this.entries.get('readOnly') || [];
    for (const literal of literals) {
      const key = `readOnly-string-${literal.address}`;
      const typeCell = cell(`const char[${literal.size}]`, key, 'type');
      typeCell.size = literal.size;
      const addressCell = cell(
        `&"${literal.text}"(${formatAddress(literal.displayAddress)}) `,
        key,
        'address'
      );
      addressCell.address = literal.displayAddress;
      const rows = [
        [
          typeCell,
          cell(`"${literal.text}"`, key, 'name'),
          cell(`${literal.text}\\0`, key, 'value'),
          addressCell,
        ],
      ];
      addresses.declare(literal.displayAddress, addressCell.key);
      entries.push({
        address: literal.displayAddress,
        // A literal the engine never wrote out has no engine address to be
        // de-duplicated against a named object; its own is as good as one.
        engineAddress:
          literal.address === null ? literal.displayAddress : literal.address,
        rows,
        synthetic: false,
        owner: 'string',
      });
    }
    this.entries.set('readOnly', entries);
  }

  addFunctions(functions: FunctionModel[], addresses: AddressTable): void {
    const entries = this.entries.get('text') || [];
    for (const fn of functions) {
      const key = `text-${fn.name}`;
      const addressCell = cell(
        `&${fn.name}(${formatAddress(fn.address)}) `,
        key,
        'address'
      );
      addressCell.address = fn.address;
      const rows = [
        [
          cell('function', key, 'type'),
          cell(fn.name, key, 'name'),
          cell('code', key, 'value'),
          addressCell,
        ],
      ];
      addresses.declare(fn.address, addressCell.key);
      entries.push({
        address: fn.address,
        engineAddress: fn.address,
        rows,
        synthetic: false,
        owner: fn.name,
      });
    }
    this.entries.set('text', entries);
  }

  segments(): MemorySegmentModel[] {
    const namedAddresses = new Set<number>();
    for (const entries of this.entries.values()) {
      for (const entry of entries) {
        if (!entry.synthetic) {
          namedAddresses.add(entry.engineAddress);
        }
      }
    }
    return MEMORY_ORDER.map((key) => {
      const entries = (this.entries.get(key) || []).filter(
        (entry) => !entry.synthetic || !namedAddresses.has(entry.engineAddress)
      );
      const first = entries.reduce<number | null>(
        (lowest, entry) =>
          lowest === null ? entry.address : Math.min(lowest, entry.address),
        null
      );
      const rows = entries.flatMap((entry) => entry.rows);
      const displayRows =
        key === 'registers'
          ? rows.map((row, index) =>
              row.map((item) => {
                if (item.kind !== 'address') {
                  return item;
                }
                // A register is a slot, not an address: the column says `R0`,
                // and carrying a number alongside it would only invite the
                // memory view to print one.
                const slot = { ...item, text: `R${index}` };
                slot.width = cellWidth(slot.text);
                delete slot.address;
                return slot;
              })
            )
          : rows;
      return {
        key,
        name: key,
        startAddress:
          key === 'registers' || first === null
            ? MEMORY_START_ADDRESSES[key]
            : first,
        rows: displayRows,
        groups: key === 'stack' ? framesOf(entries) : [],
      };
    });
  }
}

function memoryRegionOf(variable: Variable, stackName: string): MemoryRegion {
  if (variable.name.startsWith('Heap:')) {
    return 'heap';
  }
  if (variable.name.startsWith('Static:')) {
    return 'readOnly';
  }
  const declaration = declarationInfoOf(variable);
  if (declaration !== null) {
    if (declaration.region === 'register') {
      return 'registers';
    }
    if (declaration.region === 'static' || declaration.region === 'global') {
      if (declaration.readOnly) {
        return 'readOnly';
      }
      return declaration.initialized ? 'data' : 'bss';
    }
  }
  return stackName === 'GLOBAL' ? 'data' : 'stack';
}

/**
 * What the operands of the statement about to run hold going in.
 *
 * The tree the interpreter left is structure: an operator has a value once it
 * has been evaluated, and before that nothing in the statement does. But the
 * names in it are variables that exist, and a reader looking at
 * `twice(a + 1)` wants to see what `a` is without hunting for it in the
 * memory beside it. Only names are filled: a literal already says what it is,
 * and an operator that has not run has no value to give.
 */
function withOperandValues(
  expression: ExpressionModel | null,
  variables: VariableModel[]
): ExpressionModel | null {
  if (expression === null) {
    return null;
  }
  const scope = new Map(
    variables.map((variable) => [variable.name, variable.value])
  );
  const fill = (node: ExpressionNodeModel): ExpressionNodeModel => {
    const held = node.value === null ? scope.get(node.text) : undefined;
    return {
      ...node,
      value: typeof held === 'undefined' ? node.value : held,
      children: node.children.map(fill),
    };
  };
  return { ...expression, root: fill(expression.root) };
}

/**
 * What the line the editor is stopped on is about to work with.
 *
 * The names come from the statement, in the order it mentions them, and the
 * values from the frames as they stand - so this is the same reading the
 * tooltip gives, printed without being asked for. A name that belongs to no
 * object in scope is dropped rather than shown as unknown: a call to `printf`
 * mentions `printf`, and the reader is not asking about it.
 */
function inlineValuesFor(
  execState: ExecState,
  variables: VariableModel[]
): InlineValueModel[] {
  // Innermost frame last, so a name declared twice resolves to the frame being
  // executed - the same rule the tooltip reads the list backwards for.
  const scope = new Map<string, string>();
  for (const variable of variables) {
    scope.set(variable.name, variable.value);
  }
  const values: InlineValueModel[] = [];
  const seen = new Set<string>();
  for (const name of statementNames(execState.getNextExpr())) {
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const held = scope.get(name);
    if (typeof held !== 'undefined') {
      values.push({ name, display: held });
    }
    if (values.length === INLINE_VALUE_LIMIT) {
      break;
    }
  }
  return values;
}

function codeRangeOf(execState: ExecState): CodeRangeModel | null {
  const { codeRange } = execState.getNextExpr();
  if (!codeRange) {
    return null;
  }
  const { begin, end } = codeRange;
  return {
    begin: { x: begin.x, y: begin.y },
    end: { x: end.x, y: end.y },
  };
}

/**
 * The step as plain data. `null` and `undefined` are both answered with an
 * empty model: the interpreter reports states it has no `ExecState` for, and
 * the visualization has to show something for them rather than throw.
 */
export function extractModel(execState?: ExecState | null): StepModel {
  if (execState === undefined || execState === null) {
    return emptyStepModel();
  }
  const getTypedef: Typedef = execState.getTypedef.bind(execState);
  const addresses = new AddressTable();
  const memory = new MemoryCollector();
  const stacks: StackModel[] = [];
  for (const stack of execState.getStacks()) {
    const model = stackModel(stack, getTypedef, addresses, memory);
    // A stack with no variables in it yet is not drawn at all.
    if (0 < model.rows.length) {
      stacks.push(model);
    }
  }
  const functions: FunctionModel[] = runtimeFunctionsOf(execState).map(
    ({ name, address }) => ({ name, address })
  );
  memory.addFunctions(functions, addresses);
  memory.addStrings(runtimeStringsOf(execState), addresses);
  const variables = extractVariables(execState);
  return {
    stacks,
    pointers: addresses.resolve(),
    memory: memory.segments(),
    functions,
    expression: withOperandValues(expressionTraceOf(execState), variables),
    variables,
    inlineValues: inlineValuesFor(execState, variables),
    constructStates: constructStatesOf(execState),
    frames: callFramesOf(execState),
    mutations: mutationsOf(execState),
    evaluations: evaluationsOf(execState),
    codeRange: codeRangeOf(execState),
  };
}
