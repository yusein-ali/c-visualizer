import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import {
  declarationInfoOf,
  displayAddressOf,
  displayPointerValueOf,
  displaySizeOf,
  displayTypeOf,
  functionPointerInfoOf,
} from '../interpreter/RuntimeTypeInfo';
import { cSpelling, exactInteger } from '../interpreter/ExpressionTypes';
import { basicSizeof } from '../interpreter/RecordTable';
import { libraryTypedefIn } from '../interpreter/library/types';
import { VariableModel } from './model';
import type { MemoryRegion } from './model';

/**
 * Reading an execution state as the tooltip says it out loud.
 *
 * The canvas and the tooltip spell the same variable differently - the canvas
 * has a column per part and room for one line, the tooltip has a sentence and
 * follows a pointer to what it points at - so this is a second pass over the
 * same stacks rather than a reading of the cells `extractModel` produced.
 *
 * Everything it produces is text and numbers: the tooltip is on the main
 * thread and the interpreter is in the Worker, so a `Variable` never reaches
 * the editor that describes it.
 */

export const formatAddress = (address: number): string =>
  `0x${address.toString(16).toUpperCase()}`;

/**
 * The number as the declared type can actually hold it.
 *
 * The engine computes in JavaScript numbers, so an `int` that has never been
 * assigned comes back as whatever the bytes happen to say - 3909824860, a
 * value no `int` can hold. A memory view that prints it has stopped
 * describing C. Anything wider than the type is wrapped the way the machine
 * wraps it, signed or not; floating types and anything that is not a plain
 * integer are left alone.
 */
export function narrowToType(value: number, spelled: string): number | null {
  const shape = integerShapeOf(spelled);
  if (shape === null || shape.bits >= 64 || !Number.isFinite(value)) {
    return null;
  }
  const whole = BigInt(Math.trunc(value));
  return Number(
    shape.unsigned
      ? BigInt.asUintN(shape.bits, whole)
      : BigInt.asIntN(shape.bits, whole)
  );
}

/**
 * The value as the declared type holds it, as text, or null for a type that
 * is not a plain integer.
 *
 * `narrowToType` for the types a number holds exactly; for a 64-bit one, the
 * digits of the value itself, which a number past 2^53 cannot spell - to a
 * number, `LLONG_MAX` is 2^63 and prints as 9223372036854775808.
 */
export function heldText(value: number, spelled: string): string | null {
  const shape = integerShapeOf(spelled);
  if (shape === null || !Number.isFinite(value)) {
    return null;
  }
  if (shape.bits < 64) {
    return String(narrowToType(value, spelled));
  }
  const canonical = shape.unsigned ? 'unsigned long long' : 'long long';
  const whole = exactInteger(value, canonical);
  return String(
    shape.unsigned ? BigInt.asUintN(64, whole) : BigInt.asIntN(64, whole)
  );
}

/** The width and signedness of an integer type, however it is spelled. */
function integerShapeOf(
  spelled: string
): { bits: number; unsigned: boolean } | null {
  // The engine glues a sign to the word after it, `unsignedint`, and spells
  // `long long` as one word.
  const type = cSpelling(spelled).replace(
    /\b(unsigned|signed)(?=[a-z_])/g,
    '$1 '
  );
  if (
    type.indexOf('*') !== -1 ||
    type.indexOf('[') !== -1 ||
    /\b(float|double)\b/.test(type)
  ) {
    return null;
  }
  // `size_t` and the library's other integer typedefs have no header here
  // to say what they stand for, so their width and signedness are looked up.
  const typedef = libraryTypedefIn(type);
  if (typedef?.pointer === true) {
    return null;
  }
  if (
    typedef === null &&
    !/\b(char|short|int|long|unsigned|signed|bool|_Bool)\b/.test(type)
  ) {
    return null;
  }
  return {
    bits: (typedef === null ? basicSizeof(type) : typedef.bytes) * 8,
    unsigned:
      typedef === null ? type.indexOf('unsigned') !== -1 : typedef.unsigned,
  };
}

/** Whether the element of an array value is a `Variable` and not a raw value. */
const isVariable = (element: any): boolean =>
  element !== null &&
  typeof element === 'object' &&
  typeof element.getValue === 'function';

/**
 * How many members of an aggregate the tooltip shows before giving up. A
 * tooltip is a line, not the canvas: the point of it is to say what kind of
 * thing this is, and the canvas beside it draws the whole array.
 */
const SHOWN_MEMBERS = 8;

/** The memory band an interpreter variable belongs to in PLIVET's model. */
export function memoryRegionOf(
  variable: Variable,
  stackName: string
): MemoryRegion {
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

/** What a typedef name stands for, as the execution state knows it. */
type Resolve = (type: string) => string;

const unresolved: Resolve = (type) => type;

function formatValue(
  value: any,
  type: string,
  resolve: Resolve = unresolved
): string {
  if (value === null || typeof value === 'undefined') {
    return '?';
  }
  if (Array.isArray(value)) {
    const shown = value
      .slice(0, SHOWN_MEMBERS)
      .map((element: any) =>
        isVariable(element)
          ? valueOf(element, displayTypeOf(element))
          : formatValue(element, '')
      );
    return `[${shown.join(', ')}${value.length > SHOWN_MEMBERS ? ', …' : ''}]`;
  }
  if (
    typeof value === 'number' &&
    (type.indexOf('*') !== -1 || libraryTypedefIn(type)?.pointer === true)
  ) {
    return formatAddress(value);
  }
  if (typeof value === 'number' && type.indexOf('char') !== -1) {
    const held = narrowToType(value, type);
    return `'${String.fromCharCode(value & 0xff)}' (${held === null ? value : held})`;
  }
  if (typeof value === 'number') {
    // A typedef of the program's own (`u64`) says nothing until resolved.
    return (
      heldText(value, type) ?? heldText(value, resolve(type)) ?? String(value)
    );
  }
  return String(value);
}

/**
 * What a variable holds. A pointer is an address whichever kind it is, so it
 * is always shown as one; a function pointer is named as well, because the
 * address on its own says nothing about which function was chosen.
 */
function valueOf(
  variable: Variable,
  type: string,
  resolve: Resolve = unresolved
): string {
  const held = variable.getValue();
  const functionInfo = functionPointerInfoOf(variable);
  if (functionInfo !== null && held != null && !Array.isArray(held)) {
    // The engine stores an `int` as a boxed number, so a null callback would
    // print as a bare `0` if this went through the generic path.
    const address = formatAddress(Number(held.valueOf()));
    return functionInfo.pointee === null
      ? address
      : `${functionInfo.pointee} (${address})`;
  }
  const pointerValue = displayPointerValueOf(variable);
  if (pointerValue !== null) {
    return formatAddress(pointerValue);
  }
  return formatValue(held, type, resolve);
}

/**
 * The variable living at an address. Array elements are Variables held in
 * their array's value rather than in the frame, so a pointer into an array -
 * the common case the canvas draws an arrow for - is only found by looking
 * inside.
 */
function variableAt(variables: Variable[], address: number): Variable | null {
  for (const variable of variables) {
    if (variable.address === address) {
      return variable;
    }
    const value = variable.getValue();
    if (Array.isArray(value)) {
      const found = variableAt(value.filter(isVariable), address);
      if (found !== null) {
        return found;
      }
    }
  }
  return null;
}

/** For a pointer, the variable it points at - the arrow the canvas draws. */
function targetOf(
  variable: Variable,
  execState: ExecState
): VariableModel['target'] {
  const value = variable.getValue();
  if (variable.type.indexOf('*') === -1 || typeof value !== 'number') {
    return undefined;
  }
  for (const stack of execState.getStacks()) {
    const found = variableAt(stack.getVariables(), value);
    if (found !== null) {
      return {
        name: found.getName(),
        value: formatValue(found.getValue(), found.type),
      };
    }
  }
  return undefined;
}

/**
 * What every structure and union member holds, under its path: `pt.x`,
 * `o.inner.x`. Innermost frame last, as `extractVariables` lists them, so a
 * map built from this resolves a path to the frame being executed.
 *
 * Kept apart from `extractVariables`, whose names are the bare words a reader
 * can hover: a member is only ever reached through its object, and the
 * expression tree asks for it by the path the source spells.
 */
export function extractMemberValues(
  execState?: ExecState | null
): Map<string, string> {
  const values = new Map<string, string>();
  if (execState === undefined || execState === null) {
    return values;
  }
  const walk = (variable: Variable): void => {
    const held = variable.getValue();
    // An array's elements are `a[0]`, not members, and no path names them.
    if (!Array.isArray(held) || variable.type.indexOf('[') !== -1) {
      return;
    }
    for (const member of held) {
      if (!isVariable(member)) {
        continue;
      }
      values.set(member.getName(), valueOf(member, displayTypeOf(member)));
      walk(member);
    }
  };
  for (const stack of execState.getStacks()) {
    for (const variable of stack.getVariables()) {
      if (typeof variable.parentName === 'undefined') {
        walk(variable);
      }
    }
  }
  return values;
}

/**
 * Everything the tooltip can be asked about, innermost frame last: a name
 * declared in two frames means the one being executed, and reading the list
 * backwards is what finds it.
 *
 * A bare word never refers to a struct member - those are recorded under the
 * member name with the struct as their parent - so only the frame's own
 * variables are listed.
 *
 * Everything here goes through the display layer rather than the runtime one.
 * An enum, a record and a function pointer all execute under a synthetic type
 * the source never contained, and addresses are laid out for the reader before
 * the canvas draws them - so reading `type` and `address` off the variable
 * would both leak `_fp0` into the tooltip and put a different address in it
 * than the box beside it shows.
 */
export function extractVariables(
  execState?: ExecState | null
): VariableModel[] {
  if (execState === undefined || execState === null) {
    return [];
  }
  const variables: VariableModel[] = [];
  const resolve: Resolve = (type) => execState.getTypedef(type);
  const stacks = execState.getStacks();
  const activeStack = stacks
    .slice()
    .reverse()
    .find((stack) => stack.name !== 'GLOBAL');
  for (const stack of stacks) {
    for (const variable of stack.getVariables()) {
      if (typeof variable.parentName !== 'undefined') {
        continue;
      }
      const type = displayTypeOf(variable);
      const model: VariableModel = {
        name: variable.getName(),
        // The key `extractModel` builds this object's cells under. The two
        // passes are separate and have to agree on one thing, and this is it.
        key: `${stack.name}-${variable.name}`,
        type,
        value: valueOf(variable, type, resolve),
        address: displayAddressOf(variable),
        region: memoryRegionOf(variable, stack.name),
        frame: stack.name,
        active: stack === activeStack,
      };
      const size = displaySizeOf(variable);
      if (size !== null) {
        model.size = size;
      }
      const target = targetOf(variable, execState);
      if (target !== undefined) {
        model.target = target;
      }
      variables.push(model);
    }
  }
  return variables;
}
