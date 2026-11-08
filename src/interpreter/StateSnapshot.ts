import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';

/*
 * What a step costs, made proportional to the program rather than to the
 * engine's address space.
 *
 * Upstream's `Engine.stepExecute` ends every step with `ExecState.make()` and
 * a deep copy of the result through `node_helper/clone`. Profiling a loop of
 * 2000 iterations put nine tenths of the run in those two calls:
 *
 *   - `makeImple` probes every address from 10000 to 50000 for a static or a
 *     heap object, forty thousand `Map.has` calls a step whatever the program
 *     allocated;
 *   - `clone` remembers what it has copied in a list it searches linearly,
 *     so a copy of n objects costs n^2 - and the state it copies carries the
 *     construct trace, whose write log alone grows to 500 entries.
 *
 * The two functions below produce the same state. `makeState` is
 * `ExecState.make` with the band scan reading the addresses that hold
 * something, in the same ascending order. `snapshotOf` is the copy a step has
 * to keep: `make` builds every stack and every variable afresh, and the
 * trace attaches fresh arrays at every stop, so what the next step changes is
 * the state object's own fields - which the snapshot holds separately - and
 * the one log that is shared on purpose, which is cut at its length.
 */

/** The fields of `ExecState` that its declarations mark private. */
interface StateInternals {
  stacks: unknown[];
  global: Scope;
  addStack(name: string): string;
  addVariable(stackName: string, variable: Variable): void;
  hasStack(name: string): boolean;
}

/**
 * A scope that names objects living elsewhere: a block-scope `static` or
 * `extern` declaration binds its name to an object filed under the global
 * scope (`CPP14Engine.bindsExistingObject`). The object is drawn there, once,
 * and not again in every frame that can name it.
 */
export interface AliasingScope {
  plivetAliases?: Set<string>;
}

/**
 * The scope a function's block-scope statics are filed in, under the global
 * one (`CPP14Engine.declareBlockStatics`): which function declares them.
 */
export interface StaticScope {
  plivetStaticsOf?: string;
}

/** A variable read from a `StaticScope`, carrying that function's name. */
interface BlockStaticVariable {
  plivetFunction?: string;
}

/**
 * The function whose block-scope `static` this is, or null for any other
 * object. Such an object is filed with the file-scope ones because it outlives
 * every call, but its name belongs to the function that declares it.
 */
export function blockStaticFunctionOf(variable: Variable): string | null {
  const owner = (variable as BlockStaticVariable).plivetFunction;
  return typeof owner === 'string' ? owner : null;
}

/** `Array.prototype.divide`, which `unicoen.ts/dist/node_helper/Extension` adds. */
interface Divisible {
  divide(size: number): unknown[];
  isEmpty(): boolean;
}

/** The two bands `ExecState.makeImple` reads objects the program never named from. */
const BANDS: { from: number; to: number; prefix: string }[] = [
  { from: 10000, to: 20000, prefix: 'Static:' },
  { from: 20000, to: 50000, prefix: 'Heap:' },
];

/** `ExecState.make()`, with the same stacks, variables and order. */
export function makeState(state: ExecState): ExecState {
  const internals = state as unknown as StateInternals;
  internals.stacks = [];
  makeScope(internals, internals.global);
  return state;
}

function makeScope(state: StateInternals, scope: Scope): void {
  if (!state.hasStack(scope.name)) {
    state.addStack(scope.name);
    if (scope.name === 'GLOBAL') {
      for (const band of BANDS) {
        const addresses: number[] = [];
        for (const address of scope.typeOnMemory.keys()) {
          if (
            typeof address === 'number' &&
            Number.isInteger(address) &&
            band.from <= address &&
            address < band.to
          ) {
            addresses.push(address);
          }
        }
        addresses.sort((left, right) => left - right);
        for (const address of addresses) {
          const type = scope.typeOnMemory.get(address)!;
          if (type === 'FUNCTION') {
            continue;
          }
          state.addVariable(
            scope.name,
            new Variable(
              type,
              band.prefix + address,
              scope.objectOnMemory.get(address),
              address,
              scope.depth
            )
          );
        }
      }
    }
  }
  const aliases = (scope as AliasingScope).plivetAliases;
  for (const varName of Array.from(scope.variableAddress.keys())) {
    const type = scope.variableTypes.get(varName)!;
    if (
      type === 'FUNCTION' ||
      type === 'CLASS' ||
      type === 'SYSTEM' ||
      aliases?.has(varName) === true
    ) {
      continue;
    }
    let address: any = scope.variableAddress.get(varName);
    let value: any = scope.objectOnMemory.get(address);
    if (value instanceof UniNode || value instanceof Function) {
      continue;
    }
    // An array: the value is the address of its first element.
    if (type.indexOf('[') >= 0 && type.indexOf(']') >= 0) {
      const dims = scope.getArrayDims(type);
      const sum = dims.reduce((total, length) => total * length, 1);
      let startAddr = value;
      for (let i = 1; i < dims.length; i += 1) {
        startAddr = scope.objectOnMemory.get(startAddr);
      }
      const elemSizeOf = Scope.sizeof(type);
      let arrayList: unknown[] = Array.from(new Array(sum), (_, i) => {
        const addr = startAddr + i * elemSizeOf;
        return new Variable(
          null as unknown as string,
          varName,
          scope.objectOnMemory.get(addr),
          addr,
          scope.depth
        );
      });
      for (const dim of dims.reverse()) {
        arrayList = (arrayList as unknown as Divisible).divide(dim);
      }
      address = value;
      value = arrayList;
    }
    const list = structVariable(scope, type, value);
    if (!(list as unknown as Divisible).isEmpty()) {
      value = list;
    }
    const variable = new Variable(type, varName, value, address, scope.depth);
    const owner = (scope as StaticScope).plivetStaticsOf;
    if (typeof owner === 'string') {
      (variable as BlockStaticVariable).plivetFunction = owner;
    }
    state.addVariable(scope.name, variable);
  }
  for (const child of scope.children) {
    makeScope(state, child);
  }
}

/** `makeStructVariable` inside `ExecState.makeImple`. */
function structVariable(
  scope: Scope,
  structType: string,
  structAddr: any
): Variable[] {
  const fieldList: Variable[] = [];
  if (!scope.isStructType(structType)) {
    return fieldList;
  }
  if (scope.getRawType(structType) !== 'CLASS') {
    return fieldList;
  }
  const members = scope.get(structType) as Map<string, [number, string]>;
  for (const [fieldName, offsetAndType] of members) {
    const fieldType = offsetAndType[1];
    let fieldAddress = structAddr + offsetAndType[0];
    let fieldValue: any = scope.objectOnMemory.get(fieldAddress);
    const fieldValueAsStruct = structVariable(scope, fieldType, fieldValue);
    if (!(fieldValueAsStruct as unknown as Divisible).isEmpty()) {
      fieldAddress = fieldValue;
      fieldValue = fieldValueAsStruct;
    }
    fieldList.push(
      new Variable(fieldType, fieldName, fieldValue, fieldAddress, scope.depth)
    );
  }
  return fieldList;
}

/** What the construct trace attaches to a state; see `ConstructTrace.attach`. */
interface TracedState {
  plivetMutations?: unknown[];
  plivetMutationCount?: number;
}

/**
 * The state a step keeps, separate from the live one the engine goes on
 * writing to. See the comment at the top of this file for why a copy of the
 * state object's own fields is a whole copy.
 */
export function snapshotOf(state: ExecState): ExecState {
  const copy = Object.create(Object.getPrototypeOf(state)) as Record<
    string,
    unknown
  >;
  const source = state as unknown as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(source)) {
    copy[key] = source[key];
  }
  // The one array that is shared between steps: the write log grows in place
  // and drops its oldest entry past its limit, so a step keeps its own cut.
  const traced = copy as TracedState;
  if (Array.isArray(traced.plivetMutations)) {
    traced.plivetMutations = traced.plivetMutations.slice(
      0,
      traced.plivetMutationCount ?? traced.plivetMutations.length
    );
  }
  return copy as unknown as ExecState;
}
