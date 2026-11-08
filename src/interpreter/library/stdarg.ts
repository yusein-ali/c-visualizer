import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import {
  argumentClass,
  canonicalArgumentType,
  compatibleArgument,
  promotedArgumentType,
} from '../Variadic';
import { LibraryHost, VariadicFrame } from './host';
import { Memory, num } from './memory';

/**
 * `<stdarg.h>`: `va_start`, `va_arg`, `va_copy` and `va_end` over the
 * unnamed arguments the engine files in a `...` function's frame (see
 * `Variadic.ts`).
 *
 * A `va_list` is what it is on the simplest real ABIs: a pointer to the next
 * unnamed argument. The canvas draws it with an arrow onto that argument's
 * row, `va_arg` moves the arrow on by one, and after the last one it points
 * at the gap the frame leaves before the body's locals, so the arrow goes.
 *
 * The four are macros in C, and two of their operands - the `va_list`
 * `va_start` and `va_arg` modify, and the type `va_arg` reads - are nothing
 * a function can be handed. The preprocessor predefines each as a call with
 * the list's address and the type spelled as a string (`preprocess.ts`), so
 * `va_arg(ap, int)` reaches this module as `va_arg(&ap, "int")`.
 *
 * What C leaves undefined is refused rather than read: a type no unnamed
 * argument can have after the default argument promotions (`char`, `short`,
 * `float`), a type of another kind than the argument was passed as, a read
 * past the last argument, and a list that was never started.
 */

/** The library's spelling of a `va_list`'s type, for the canvas's typedef. */
const VA_LIST_TYPE = 'char*';

/** `num` for the value a `va_list` object holds. */
const listValue = (global: Scope, address: number): number =>
  num(global.objectOnMemory.get(address));

/** A frame's function as the reader named it: `sum`, not `sum.2`. */
const functionName = (frame: VariadicFrame): string =>
  frame.function.replace(/\.\d+$/, '');

const plural = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Where a list points, as the mutation view says it: by the row of the
 * argument rather than by an address, which the canvas lays out afresh.
 */
const position = (frame: VariadicFrame | null, address: number): string => {
  if (frame === null) {
    return '?';
  }
  const arg = frame.args.find((one) => one.address === address);
  return typeof arg === 'undefined'
    ? 'past the last unnamed argument'
    : `points at ${arg.name}`;
};

/**
 * The values a `va_list` stands for, from the argument it points at to the
 * last: what `vprintf` and its family format.
 */
export function variadicValues(
  host: LibraryHost,
  list: unknown,
  caller: string
): unknown[] {
  const at = num(list);
  const frame = Number.isFinite(at) ? host.variadicFrameAt(at) : null;
  if (frame === null) {
    host.refuse(
      'invalid-va-list',
      `${caller} takes a va_list that va_start has started - the unnamed ` +
        `arguments of a function declared with ... - and was given something ` +
        `else, or a list va_end has already ended`
    );
  }
  const index = frame.args.findIndex((arg) => arg.address === at);
  return (index === -1 ? [] : frame.args.slice(index)).map((arg) =>
    host.global.objectOnMemory.get(arg.address)
  );
}

export function installStdarg(global: Scope, host: LibraryHost): void {
  const memory = new Memory(host);
  const define = (name: string, fn: (...args: any[]) => unknown): void =>
    global.setTop(name, fn, 'FUNCTION');
  const resolve = (type: string): string => global.getTypedef(type);
  // The canvas draws a `va_list` as the pointer it is.
  if (!global.typedefList.has('va_list')) {
    global.setTypedef(VA_LIST_TYPE, 'va_list');
  }

  /** The words a macro's operand was spelled with, from its string. */
  const spelled = (value: unknown, fn: string, what: string): string =>
    String.fromCharCode(...memory.string(value, fn, what).bytes).trim();

  /** The `va_list` object a call names, by the address the macro took. */
  const listObject = (pointer: unknown, fn: string): number => {
    const address = memory.pointer(pointer, fn, 'the va_list');
    memory.region(address, 4, fn, 'the va_list', true);
    return address;
  };

  /** Stores where a list points, and says so in the mutation view. */
  const point = (list: number, to: number | null, fn: string): void => {
    const held = listValue(global, list);
    const before =
      host.isUnwritten(list) || !Number.isFinite(held)
        ? '?'
        : position(host.variadicFrameAt(held), held);
    host.write(list, to, fn);
    host.note(
      memory.objectAt(list)?.name ?? 'va_list',
      before,
      to === null ? 'ended' : position(host.variadicFrameAt(to), to)
    );
  };

  define('va_start', (pointer: unknown, last: unknown) => {
    const list = listObject(pointer, 'va_start');
    const frame = host.variadicFrame();
    if (frame === null) {
      host.refuse(
        'va-start-outside-variadic',
        'va_start is used in a function that was not declared with ..., so ' +
          'there are no unnamed arguments to start on'
      );
    }
    const named = spelled(last, 'va_start', 'the last named parameter');
    if (frame.last !== null && named !== frame.last) {
      host.warn(
        'va-start-last',
        `the second argument of va_start should be ${frame.last}, the last ` +
          `named parameter of ${functionName(frame)}; C leaves any other ` +
          `name undefined`
      );
    }
    point(list, frame.args[0]?.address ?? frame.end, 'va_start');
  });

  define('va_arg', (pointer: unknown, type: unknown) => {
    const list = listObject(pointer, 'va_arg');
    const requested = spelled(type, 'va_arg', 'the type');
    const at = listValue(global, list);
    const frame =
      Number.isFinite(at) && !host.isUnwritten(list)
        ? host.variadicFrameAt(at)
        : null;
    if (frame === null) {
      host.refuse(
        'va-arg-without-start',
        'va_arg reads from a va_list that va_start has not started, or that ' +
          'va_end has already ended; its value is indeterminate'
      );
    }
    const index = frame.args.findIndex((arg) => arg.address === at);
    if (index === -1) {
      host.refuse(
        'va-arg-past-end',
        `va_arg asks for another unnamed argument, but this call of ` +
          `${functionName(frame)} was given only ` +
          `${plural(frame.args.length, 'unnamed argument')}; reading past ` +
          `the last one has undefined behavior`
      );
    }
    const arg = frame.args[index];
    const wanted = canonicalArgumentType(requested, resolve);
    const given = canonicalArgumentType(arg.type, resolve);
    const promoted = promotedArgumentType(wanted);
    if (promoted !== wanted) {
      host.refuse(
        'va-arg-promoted',
        `va_arg asks for ${requested}, which no unnamed argument can be: a ` +
          `${requested} argument is promoted to ${promoted} when it is ` +
          `passed through ..., so ask for ${promoted}`
      );
    }
    if (!compatibleArgument(wanted, given)) {
      const message =
        `va_arg asks for ${requested}, but ${arg.name}, the next unnamed ` +
        `argument, was passed as ${arg.type}`;
      if (argumentClass(wanted) !== argumentClass(given)) {
        host.refuse(
          'va-arg-type',
          `${message}; reading it as ${requested} has undefined behavior`
        );
      }
      host.warn(
        'va-arg-type',
        `${message}; C leaves reading it as ${requested} undefined, although ` +
          `the two have the same size here`
      );
    }
    point(list, frame.args[index + 1]?.address ?? frame.end, 'va_arg');
    return global.objectOnMemory.get(arg.address);
  });

  define('va_copy', (pointer: unknown, source: unknown) => {
    const list = listObject(pointer, 'va_copy');
    const at = num(source);
    if (!Number.isFinite(at) || host.variadicFrameAt(at) === null) {
      host.refuse(
        'va-arg-without-start',
        'va_copy copies a va_list that va_start has not started, or that ' +
          'va_end has already ended'
      );
    }
    point(list, at, 'va_copy');
  });

  define('va_end', (pointer: unknown) => {
    // After va_end the list's value is indeterminate: drawn as such, and
    // refused by a va_arg that reads it.
    point(listObject(pointer, 'va_end'), null, 'va_end');
  });
}
