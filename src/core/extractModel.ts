import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Stack } from 'unicoen.ts/dist/interpreter/Engine/Stack';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { RuntimeDeclarationInfo } from '../interpreter/DeclarationSpecifiers';
import {
  declarationInfoOf,
  displayAddressOf,
  displayPointerValueOf,
  displayTypeOf,
  enumInfoOf,
  functionPointerInfoOf,
} from '../interpreter/RuntimeTypeInfo';
import {
  CellModel,
  CodeRangeModel,
  PointerModel,
  StackModel,
  StepModel,
  cellWidth,
  emptyStepModel,
  foldGroupOf,
} from './model';

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
  const enumInfo = enumInfoOf(variable);
  const functionInfo = functionPointerInfoOf(variable);

  if (functionInfo !== null && value != null) {
    // A function pointer holds an address like any other pointer, so it is
    // shown like one; the name is what makes the address mean something.
    const hex = '0x' + Number(value.valueOf()).toString(16).toUpperCase();
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
    valueStr =
      '0x' +
      (pointerValue === null ? value : pointerValue).toString(16).toUpperCase();
  }
  if (rawType === 'char' && value != null) {
    valueStr += ` '${String.fromCharCode(valueStr)}'`;
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
  const nameCell = cell(name, key, 'name', foldGroup);
  const valueCell = cell(
    valueTextOf(variable, getTypedef),
    key,
    'value',
    foldGroup
  );
  const addressCell = cell(
    `&${name}(0x${address.toString(16).toUpperCase()}) `,
    key,
    'address',
    foldGroup
  );

  if (functionInfo === null && getTypedef(type).indexOf('*') !== -1) {
    // The value is an address, and the cell showing it is where the arrow
    // starts.
    const pointerValue = displayPointerValueOf(variable);
    addresses.points(pointerValue === null ? value : pointerValue, valueCell);
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
  const nameCell = cell(name, key, 'name', foldGroup);
  // An aggregate holds its own address: the arrow from it points at itself,
  // which is what shows that the name and the storage are the same thing.
  const valueCell = cell(
    '0x' + address.toString(16).toUpperCase(),
    key,
    'value',
    foldGroup
  );
  const addressCell = cell(`&${name}(SYSTEM)`, key, 'address', foldGroup);
  // The triangle itself is the layout's to draw: which way it points is fold
  // state, and fold state is not part of the model. The cell is as wide as the
  // one character that will go in it.
  const foldCell: CellModel = {
    key: `${key}-fold`,
    text: '',
    kind: 'fold',
    width: cellWidth(' '),
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
  addresses: AddressTable
): StackModel {
  const rows: CellModel[][] = [];
  for (const variable of stack.getVariables()) {
    rows.push(
      ...variableRows(variable, stack.name, undefined, getTypedef, addresses)
    );
  }
  return { key: stack.name, name: stack.name, rows };
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
  const stacks: StackModel[] = [];
  for (const stack of execState.getStacks()) {
    const model = stackModel(stack, getTypedef, addresses);
    // A stack with no variables in it yet is not drawn at all.
    if (0 < model.rows.length) {
      stacks.push(model);
    }
  }
  return {
    stacks,
    pointers: addresses.resolve(),
    codeRange: codeRangeOf(execState),
  };
}
