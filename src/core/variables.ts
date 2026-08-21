import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import {
  displayAddressOf,
  displayPointerValueOf,
  displayTypeOf,
  functionPointerInfoOf,
} from '../interpreter/RuntimeTypeInfo';
import { basicSizeof } from '../interpreter/RecordTable';
import { VariableModel } from './model';

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
export function narrowToType(value: number, type: string): number | null {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return null;
  }
  if (
    type.indexOf('*') !== -1 ||
    type.indexOf('[') !== -1 ||
    /\b(float|double)\b/.test(type)
  ) {
    return null;
  }
  if (!/\b(char|short|int|long|unsigned|signed|bool|_Bool)\b/.test(type)) {
    return null;
  }
  const bits = basicSizeof(type) * 8;
  if (bits >= 64) {
    return null;
  }
  const whole = BigInt(Math.trunc(value));
  return Number(
    type.indexOf('unsigned') === -1
      ? BigInt.asIntN(bits, whole)
      : BigInt.asUintN(bits, whole)
  );
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

function formatValue(value: any, type: string): string {
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
  if (typeof value === 'number' && type.indexOf('*') !== -1) {
    return formatAddress(value);
  }
  if (typeof value === 'number' && type.indexOf('char') !== -1) {
    const held = narrowToType(value, type);
    return `'${String.fromCharCode(value & 0xff)}' (${held === null ? value : held})`;
  }
  if (typeof value === 'number') {
    const held = narrowToType(value, type);
    return String(held === null ? value : held);
  }
  return String(value);
}

/**
 * What a variable holds. A pointer is an address whichever kind it is, so it
 * is always shown as one; a function pointer is named as well, because the
 * address on its own says nothing about which function was chosen.
 */
function valueOf(variable: Variable, type: string): string {
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
  return formatValue(held, type);
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
  for (const stack of execState.getStacks()) {
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
        value: valueOf(variable, type),
        address: displayAddressOf(variable),
      };
      const target = targetOf(variable, execState);
      if (target !== undefined) {
        model.target = target;
      }
      variables.push(model);
    }
  }
  return variables;
}
