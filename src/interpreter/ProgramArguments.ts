import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';

/**
 * `int main(int argc, char *argv[])`: the program's arguments, as C hands
 * them over.
 *
 * Before `main` runs, the strings are stored as `char` arrays and an array of
 * `argc + 1` pointers to them, the last a null pointer, is stored after
 * them; `argv` is the address of that array's first element. All of them are
 * objects of static storage among the program's globals - drawn in the data
 * segment like any initialized global array - under names no program can
 * write: `_argv` for the array of pointers and `_argv_0`, `_argv_1`, ... for
 * the strings, the way a string literal is drawn as `_unnamed_cs_0`.
 *
 * The memory is written here cell by cell rather than by declaring
 * `char *_argv[] = {...}` and running it: an array of `char *` declared that
 * way has been mis-stored by the engine (as one pointer), and argv has to
 * work whatever the state of declaration parsing. A `char` is one engine
 * cell, as a string literal's are, and a pointer one cell of pointer width.
 */

/** The objects the arguments were stored as. */
export interface StoredArguments {
  argc: number;
  /** The address of `_argv[0]`, which is what `argv` holds. */
  argv: number;
  /**
   * Every address the objects occupy - each name's own cell and each
   * element - for the engine to record as initialized static storage.
   */
  addresses: number[];
}

/**
 * The names `main` gives its first two parameters, or null for a `main`
 * that takes fewer (`int main(void)`), which ignores its arguments.
 */
export function mainParameterNames(
  main: UniFunctionDec | null
): { argc: string; argv: string } | null {
  const params = main?.params ?? [];
  if (params.length < 2) {
    return null;
  }
  const names = params
    .slice(0, 2)
    .map((param) => (param.variables[0]?.name ?? '').replace(/^[*&]+/, ''));
  if (names.some((name) => name === '')) {
    return null;
  }
  return { argc: names[0], argv: names[1] };
}

/** A name for an object of the arguments that nothing else has taken. */
const freeName = (global: Scope, wanted: string): string => {
  let name = wanted;
  while (global.variableAddress.has(name)) {
    name = `_${name}`;
  }
  return name;
};

/**
 * Cells for `values` at the global scope's cursor, as the engine lays out a
 * global array: one cell per element, each `Scope.sizeof(type)` wide.
 */
const allocate = (global: Scope, values: number[], type: string): number => {
  const width = Scope.sizeof(type);
  const first = global.address.stackAddress;
  values.forEach((value, index) => {
    global.objectOnMemory.set(first + index * width, value);
    global.typeOnMemory.set(first + index * width, type);
  });
  global.address.stackAddress = first + values.length * width;
  return first;
};

/**
 * An array object named `name`: like the engine's own, a cell holding the
 * address of the first element, typed with the dimension.
 */
const declareArray = (
  global: Scope,
  name: string,
  first: number,
  type: string
): number => {
  const holder = global.setCode(first, type);
  global.variableTypes.set(name, type);
  global.variableAddress.set(name, holder);
  return holder;
};

/**
 * Stores `args` - `argv[0]` first - as described above, in the global scope
 * of a program about to run.
 */
export function storeProgramArguments(
  global: Scope,
  args: readonly string[]
): StoredArguments {
  const pointerType = 'char*';
  const pointerWidth = Scope.sizeof(pointerType);
  const addresses: number[] = [];
  // The array first, so it is drawn above the strings it points at; its
  // elements are filled in once the strings have addresses.
  const vector = allocate(
    global,
    new Array(args.length + 1).fill(0),
    pointerType
  );
  const vectorName = freeName(global, '_argv');
  addresses.push(
    declareArray(
      global,
      vectorName,
      vector,
      `${pointerType}[${args.length + 1}]`
    )
  );
  args.forEach((text, index) => {
    const bytes = Array.from(text, (character) => character.charCodeAt(0));
    bytes.push(0);
    const first = allocate(global, bytes, 'char');
    addresses.push(
      declareArray(
        global,
        freeName(global, `${vectorName}_${index}`),
        first,
        `char[${bytes.length}]`
      )
    );
    bytes.forEach((_, offset) => addresses.push(first + offset));
    global.objectOnMemory.set(vector + index * pointerWidth, first);
  });
  for (let index = 0; index <= args.length; index += 1) {
    addresses.push(vector + index * pointerWidth);
  }
  return { argc: args.length, argv: vector, addresses };
}
