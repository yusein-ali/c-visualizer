import { CPP14Engine } from 'unicoen.ts/dist/interpreter/CPP14/CPP14Engine';
import { Int } from 'unicoen.ts/dist/interpreter/CPP14/Int';
import {
  ControlException,
  Engine,
  Exit,
} from 'unicoen.ts/dist/interpreter/Engine/Engine';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Scope } from 'unicoen.ts/dist/interpreter/Engine/Scope';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';
import { UniArray } from 'unicoen.ts/dist/node/UniArray';
import { UniBlock } from 'unicoen.ts/dist/node/UniBlock';
import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniCharacterLiteral } from 'unicoen.ts/dist/node/UniCharacterLiteral';
import { UniClassDec } from 'unicoen.ts/dist/node/UniClassDec';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniDoubleLiteral } from 'unicoen.ts/dist/node/UniDoubleLiteral';
import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniIntLiteral } from 'unicoen.ts/dist/node/UniIntLiteral';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniNoneLiteral } from 'unicoen.ts/dist/node/UniNoneLiteral';
import { UniProgram } from 'unicoen.ts/dist/node/UniProgram';
import { UniStringLiteral } from 'unicoen.ts/dist/node/UniStringLiteral';
import { UniStatement } from 'unicoen.ts/dist/node/UniStatement';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import {
  DeclarationSpecifiers,
  RuntimeDeclarationInfo,
  StorageClass,
  StorageRegion,
} from './DeclarationSpecifiers';
import { DesignatedInitializers } from './DesignatedInitializers';
import {
  ConstructRecorder,
  markAddress,
  parameterNames,
} from './ConstructTrace';
import { basicSizeof, FieldOffset, Member, RecordTable } from './RecordTable';
import { RuntimeDiagnostic } from './RuntimeDiagnostic';
import {
  convertsInexactly,
  TYPED_OPERATORS,
  evaluate,
  valueAs,
  valueText,
} from './Arithmetic';
import { decodedText } from './Escapes';
import { ASSIGNMENT, ExpressionRecorder } from './ExpressionTrace';
import {
  canonicalType,
  commonType,
  ENGINE_LONG_LONG,
  ENGINE_UNSIGNED_LONG_LONG,
  exactLiteral,
  integerTypeInfo,
  isArithmeticType,
  isFloatingType,
  isInexact,
  isIntegerType,
  literalType,
  promotedType,
} from './ExpressionTypes';
import { literalSpelling } from './LiteralSpelling';
import { LIBRARY_CONSTANTS } from './library/constants';
import { Expansion, originalRange } from './Expansion';
import {
  LibraryHost,
  RecordCell,
  SourceLine,
  VariadicFrame,
  installLibrary,
} from './library';
import { ASSERT_FILE } from './library/assert';
import { Memory } from './library/memory';
import { mainParameterNames, storeProgramArguments } from './ProgramArguments';
import {
  installLibraryTypedefs,
  LIBRARY_TYPEDEFS,
  libraryRecordTypes,
  libraryTypedefIn,
} from './library/types';
import {
  STDIO_FUNCTIONS,
  StdioHost,
  StdioRuntime,
  installStdio,
} from './library/stdio';
import { OutputSpan, STDIO_CONSTANTS } from './stream';
import {
  AliasingScope,
  StaticScope,
  makeState,
  snapshotOf,
} from './StateSnapshot';
import { StructTable } from './StructTable';
import { UnionTable } from './UnionTable';
import {
  argumentTypeOf,
  promotedArgument,
  typeOfValue,
  variadicFunctionsIn,
  variadicName,
} from './Variadic';

/**
 * Where function addresses are reported from.
 *
 * unicoen.ts starts its code segment at address 0, so the first function a
 * program defines is filed at 0 - the null pointer. A pointer to it would then
 * be false in an `if`, equal to `NULL`, and drawn as nothing, which is the one
 * thing a pointer to a real function can never be. Reporting the segment from
 * a fixed base fixes all three at once. 0x1000 also leaves the small teaching
 * programs this interpreter is built for room before the static area at
 * 10000, which is where a text segment belongs.
 */
export const CODE_SEGMENT_BASE = 0x1000;

/**
 * An illustrative amount of text memory for one parsed expression.
 *
 * This is a teaching estimate, not an ABI rule. Real machine code can occupy
 * more or fewer bytes depending on the processor and on the complexity of
 * each expression.
 */
export const TEXT_BYTES_PER_EXPRESSION = 16;

/**
 * The binary operators unicoen's engine has no case for, for operands whose
 * C types cannot be told from the tree. Where they can - nearly always - the
 * operator is computed by `Arithmetic.ts` instead, which shifts an unsigned
 * value logically; here `>>` is the arithmetic shift of a signed `int`.
 */
const BITWISE: Record<string, (l: number, r: number) => number> = {
  '&': (l, r) => l & r,
  '|': (l, r) => l | r,
  '^': (l, r) => l ^ r,
  '<<': (l, r) => l << r,
  '>>': (l, r) => l >> r,
};

/** `++` and `--`, in every spelling the mapper and the engine give them. */
const INCREMENT_OPERATORS = ['++', '--', '_++', '++_', '_--', '--_'];

/** The library functions whose result type an operator needs to know. */
const LIBRARY_RETURN_TYPES: Record<string, string> = {
  // `strlen(s) - 1` on an empty string is the classic wrap-around.
  strlen: 'unsigned long',
};

/**
 * A computed value as the engine keeps one of its type: an `Int` for an
 * integer that fits one (which is what tells the engine's own division that
 * it divides integers), a plain number for a `char`, a floating value, and an
 * unsigned or `long long` value past `INT_MAX` - the convention `cWide` in
 * `library/memory.ts` follows too.
 */
const engineValue = (value: number, type: string): any => {
  const integer = integerTypeInfo(type);
  if (integer === null || integer.bits <= 8) {
    return value;
  }
  return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647
    ? new Int(value)
    : value;
};

/**
 * An initializer for an array of scalars, element by element: a nested brace
 * list (or a string literal's bytes) fills one row, and a bare value the next
 * element, as C's brace elision does. Positions nothing reached are
 * `undefined`, which the caller zero-fills.
 */
const placedInitializer = (value: unknown, lengths: number[]): unknown[] => {
  const size = lengths.reduce((total, length) => total * length, 1);
  const placed: unknown[] = new Array(size).fill(undefined);
  if (!Array.isArray(value)) {
    placed[0] = value;
    return placed;
  }
  if (lengths.length === 1) {
    value.slice(0, size).forEach((item, index) => {
      placed[index] = Array.isArray(item) ? item[0] : item;
    });
    return placed;
  }
  const row = size / lengths[0];
  let cursor = 0;
  for (const item of value) {
    if (cursor >= size) {
      break;
    }
    if (Array.isArray(item)) {
      cursor = Math.ceil(cursor / row) * row;
      placedInitializer(item, lengths.slice(1)).forEach((inner, index) => {
        if (typeof inner !== 'undefined' && cursor + index < size) {
          placed[cursor + index] = inner;
        }
      });
      cursor += row;
    } else {
      placed[cursor] = item;
      cursor += 1;
    }
  }
  return placed;
};

/**
 * How many elements an initializer list fills, when the first dimension is
 * left for it to say (`char *names[] = {...}`): `placedInitializer`'s count.
 */
const placedCount = (value: unknown[], inner: number[]): number => {
  const row = inner.reduce((total, length) => total * length, 1);
  if (inner.length === 0) {
    return value.length;
  }
  let cursor = 0;
  for (const item of value) {
    if (Array.isArray(item)) {
      cursor = Math.ceil(cursor / row) * row + row;
    } else {
      cursor += 1;
    }
  }
  return cursor;
};

/** A typedef visible from a scope: each scope keeps its own. */
const typedefIn = (scope: Scope | null, name: string): string | null => {
  for (
    let at: Scope | null = scope;
    at !== null && typeof at !== 'undefined';
    at = at.parent
  ) {
    const list = (at as unknown as { typedefList?: Map<string, string> })
      .typedefList;
    const found = list?.get(name);
    if (typeof found === 'string') {
      return found;
    }
  }
  return null;
};

/**
 * Runtime-backed stdio routines that occupy illustrative text memory too.
 *
 * They have no parsed `UniFunctionDec`, so the ordinary function index cannot
 * discover them. Keeping the list here makes the modeled code segment agree
 * with the stdio functions the runtime actually installs.
 */
const STDIO_FUNCTION_NAMES = [
  'printf',
  'scanf',
  'gets',
  'getchar',
  'fopen',
  'fgetc',
  'fgets',
  'fputc',
  'fputs',
  'fflush',
  'fclose',
  'sprintf',
  'snprintf',
  'sscanf',
  'fprintf',
  'fscanf',
  'puts',
  'putchar',
  'ungetc',
  'fread',
  'fwrite',
  'fseek',
  'ftell',
  'rewind',
  'feof',
  'ferror',
  'clearerr',
  'perror',
  'remove',
  'rename',
  'vprintf',
  'vfprintf',
  'vsprintf',
  'vsnprintf',
] as const;

/**
 * The library functions whose stores are not listed one object at a time in
 * the mutation view: they say what they did with `LibraryHost.note`, or (for
 * `calloc`) the store is the allocation itself.
 */
const UNRECORDED_LIBRARY_WRITES = [
  'calloc',
  'realloc',
  'va_start',
  'va_arg',
  'va_copy',
  'va_end',
];

/** The standard streams, which a program that names one sees as an object. */
const STANDARD_STREAMS = ['stdin', 'stdout', 'stderr'] as const;

/** Illustrative code size for a runtime-backed library function. */
const LIBRARY_FUNCTION_TEXT_SIZE = TEXT_BYTES_PER_EXPRESSION;

/** The supported stdio routines called anywhere in the parsed program. */
function usedStdioFunctionsIn(root: unknown): Set<string> {
  const used = new Set<string>();
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (seen.has(node)) {
      return;
    }
    seen.add(node);
    if (
      node instanceof UniMethodCall &&
      node.receiver === null &&
      node.methodName instanceof UniIdent &&
      STDIO_FUNCTION_NAMES.some((name) => name === node.methodName.name)
    ) {
      used.add(node.methodName.name);
    }
    const sourceNode = node as { fields?: Map<string, unknown> } & Record<
      string,
      unknown
    >;
    if (typeof sourceNode.fields === 'undefined') {
      return;
    }
    for (const field of Array.from(sourceNode.fields.keys())) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(sourceNode[field]);
      }
    }
  };
  visit(root);
  return used;
}

/** Whether an identifier with this name appears anywhere in the program. */
function mentions(root: unknown, name: string): boolean {
  const seen = new Set<unknown>();
  const visit = (node: unknown): boolean => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return false;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      return node.some(visit);
    }
    if (node instanceof UniIdent && node.name === name) {
      return true;
    }
    const sourceNode = node as { fields?: Map<string, unknown> } & Record<
      string,
      unknown
    >;
    if (typeof sourceNode.fields === 'undefined') {
      return false;
    }
    return Array.from(sourceNode.fields.keys()).some(
      (field) =>
        field !== 'comments' &&
        field !== 'codeRange' &&
        visit(sourceNode[field])
    );
  };
  return visit(root);
}

/** The illustrative number of bytes occupied by one function's code. */
function textSizeOf(dec: UniFunctionDec): number {
  let expressions = 0;
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (node instanceof UniExpr && !(node instanceof UniStatement)) {
      expressions += 1;
    }
    for (const child of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else {
        visit(child);
      }
    }
  };
  visit(dec.block);
  // Even an empty function needs its own non-overlapping address.
  return Math.max(1, expressions) * TEXT_BYTES_PER_EXPRESSION;
}

/**
 * A node's own span, in the interpreter's coordinates. Everything a runtime
 * diagnostic can blame is a node, and a diagnostic with nowhere to point is
 * not raised at all - the console line still says what happened.
 */
const rangeOfNode = (node: any): RuntimeDiagnostic | null => {
  const range =
    node === null || typeof node === 'undefined' ? null : node.codeRange;
  if (!range || !range.begin || !range.end) {
    return null;
  }
  return {
    rule: '',
    severity: 'error',
    message: '',
    fatal: true,
    line: range.begin.y,
    column: range.begin.x,
    endLine: range.end.y,
    endColumn: range.end.x,
  };
};

/**
 * Where the lines of the executed source came from: the engine runs every
 * file of a program as one translation unit.
 */
export interface SourceLocator {
  /** The file the program starts in. */
  entry: string;
  /** The file and file-local line of an executed line, or null. */
  locate(line: number): SourceLine | null;
}

/** One store a library function made, for the mutation view. */
interface LibraryWrite {
  address: number;
  /** The function that stored it. */
  fn: string;
  type: string;
  before: unknown;
  after: unknown;
}

/**
 * What a refusal throws: an `Exit`, so it ends the run from any depth of
 * calls (see `refuse`). The reason is kept for whoever catches it.
 */
class RuntimeRefusal extends Exit {
  constructor(readonly reason: string) {
    super(null);
  }
}

/** What one subscript or dereference of a type leaves: `int[3][4]` -> `int[4]`. */
function elementTypeOf(type: string): string {
  const array = /^([^[]*)\[[^\]]*\]((?:\[[^\]]*\])*)$/.exec(type.trim());
  if (array !== null) {
    return array[1].trim() + array[2];
  }
  return type.trim().replace(/\s*\*$/, '');
}

/**
 * Where the engine's static area begins (`Scope` starts its cursors at
 * `new Address(0, 10000, 20000, 50000)`). Below it is the code area, which is
 * where string literals and the library's own functions are written.
 */
const STATIC_AREA_BASE = 10000;

/** Where one string literal is, if it is anywhere: not every literal is. */
export interface StringLiteralLocation {
  /** The engine's own address, or `null` for a literal it never wrote out. */
  address: number | null;
  text: string;
  /** The bytes it would occupy, terminator included. */
  size: number;
}

/**
 * Every string literal in the program, in the order it was written.
 *
 * The engine only puts a literal in memory when something is initialized with
 * it: `const char *p = "hi"` writes the bytes and hands over the address, but
 * `printf("%d\n", n)` passes the bytes themselves and never gives them a
 * home. In C every literal is an object in read-only memory, so the program is
 * read for them rather than the memory alone.
 *
 * The walk is reflective because the node classes have no common accessor for
 * their children, and a switch over every one of them would have to be revised
 * each time unicoen adds a node.
 */
function stringLiteralsIn(root: unknown): string[] {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (node instanceof UniStringLiteral) {
      const text = PlivetCPP14Engine.escapeText(String(node.value));
      if (texts.indexOf(text) === -1) {
        texts.push(text);
      }
      return;
    }
    for (const child of Object.values(node as Record<string, unknown>)) {
      if (Array.isArray(child)) {
        child.forEach(walk);
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return texts;
}

/** A control character reads better as the escape it was written with. */
const ESCAPES: Record<string, string> = {
  '\n': '\\n',
  '\t': '\\t',
  '\r': '\\r',
  '\0': '\\0',
  '\v': '\\v',
  '\f': '\\f',
};

const escapedText = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u001f]/g, (character) =>
    typeof ESCAPES[character] === 'undefined'
      ? `\\x${character.charCodeAt(0).toString(16).padStart(2, '0')}`
      : ESCAPES[character]
  );

/** Runtime reality is looser than unicoen.ts's declarations for tagless types. */
interface RuntimeClassDec {
  className: string | null;
  codeRange: { begin: { y: number } } | null;
}

interface RecordArrayAllocation {
  type: string;
  descriptors: number[];
  scope: Scope;
}

/**
 * unicoen.ts marks its two dispatch helpers private, so they are absent from
 * the declarations even though the running class has them. Naming them here is
 * how an override can hand a call on to the machinery that already knows how
 * to assign argument values to parameters and push a stack frame.
 */
interface DispatchingEngine {
  execFunc(
    dec: UniFunctionDec,
    scope: Scope,
    args: any[] | null
  ): Generator<any, any, any>;
  execFuncCall(func: unknown, args: any[]): Generator<any, any, any>;
}

/** A declarator whose `*`s the first execution moved off its name. */
interface PointerDeclarator {
  plivetPointers?: number;
}

/** A name a block declaration binds to an object it does not create. */
interface BoundName {
  name: string;
  address: number;
  type: string;
}

/** The identifier a declarator declares, without the `*`s the mapper left on it. */
const declaredName = (name: string): string => name.replace(/^[*&]+/, '');

/** Whether an initializer calls anything, which a constant one cannot. */
const callsAnything = (node: any): boolean => {
  if (node === null || typeof node !== 'object') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(callsAnything);
  }
  if (node instanceof UniMethodCall) {
    return true;
  }
  if (typeof node.fields === 'undefined') {
    return false;
  }
  return (Array.from(node.fields.keys()) as string[]).some(
    (field) =>
      field !== 'comments' &&
      field !== 'codeRange' &&
      callsAnything(node[field])
  );
};

/** The layout helpers of `Scope` that its declarations mark private. */
interface ScopeInternals {
  setArray(value: unknown[], type: string, dims: number[]): number;
  setPrimitiveOnCode(key: string, value: unknown, type: string): void;
}

/** The stepping state `Engine.stepExecute` keeps in fields marked private. */
interface SteppingEngine {
  execStepItr: Iterator<unknown> | null | undefined;
  isSetNextExpr: boolean;
  isWaitingForStdin: boolean;
}

/**
 * The standard-library functions PLIVET replaces, and why.
 *
 * Upstream's `printf` hands formatting to agh.sprintf after rewriting every
 * argument whose value is the address of a `char` into a string, whatever
 * conversion was going to consume it - so `%p` of a `char *` printed the
 * characters, an integer equal to such an address printed as a string, `%n`
 * stored nothing, and a string literal (passed as the engine's byte array)
 * printed as `97,98,99,0`. `printf`, `sprintf`, `snprintf` and `sscanf` are
 * PLIVET's own, in `library/stdio.ts` over `printf.ts`: each argument is read
 * by the conversion that consumes it. See `includeStdio`.
 *
 * `scanf` is replaced outright rather than wrapped: the stock one hands the
 * read to the `scanf` npm package, which has no notion of a conversion that
 * fails (see `scanf.ts`). So is the rest of upstream's `<stdio.h>`, whose
 * `FILE` objects had no standard streams, no end of input and no buffering
 * a program could see: every stream function is `library/stdio.ts` over the
 * `FILE` of `stream.ts`.
 */
export class PlivetCPP14Engine extends CPP14Engine {
  /**
   * The engine's `sizeof` - a static of unicoen's `Engine`, which `Scope` and
   * `Variable` copy - with `long long` eight bytes wide (`basicSizeof`).
   * Upstream knows only one-word types and gives every one it does not
   * recognise four bytes, which is what `long long` became when the rewrite
   * wrote it as one word. The same function every time, so a second instance
   * replaces it with itself.
   */
  constructor() {
    super();
    Engine.sizeof = basicSizeof;
    Scope.sizeof = basicSizeof;
    Variable.sizeof = basicSizeof;
  }

  private structs = new StructTable();
  private unions = new UnionTable();
  private declarationSpecifiers = new DeclarationSpecifiers();
  private designatedInitializers = new DesignatedInitializers();
  private readonly recordArrays = new Map<number, RecordArrayAllocation>();
  /** Every string literal the program contains, in source order. */
  private sourceStrings: string[] = [];
  private readonly declarationInfoByAddress = new Map<
    number,
    RuntimeDeclarationInfo
  >();
  /** Where each function was filed on the code segment, both ways round. */
  private readonly functionAddresses = new Map<string, number>();
  private readonly functionsByAddress = new Map<number, UniFunctionDec>();
  /**
   * What each heap block was asked for: its size in bytes, and whether
   * `calloc` zeroed it. See `layOutHeapRecords`.
   */
  private readonly heapRequests = new Map<
    number,
    { bytes: number; zeroed: boolean }
  >();
  /** The heap blocks laid out as records: their type and how many. */
  private readonly recordBlocks = new Map<
    number,
    { type: string; count: number }
  >();
  /** Each function as it binds its arguments; see `adjustedParameters`. */
  private readonly adjustedDeclarations = new WeakMap<
    UniFunctionDec,
    UniFunctionDec
  >();
  /** Each function's code size, once measured; see `textSizeOf`. */
  private readonly textSizes = new WeakMap<UniFunctionDec, number>();
  /** Runtime library functions have names and addresses, but no UniFunctionDec. */
  private readonly libraryFunctionsByAddress = new Map<number, string>();
  /** Stdio routines referenced by this program, whether or not execution reaches them. */
  private usedStdioFunctions = new Set<string>();
  private globalScope: Scope | null = null;
  /** The global scope the library's typedefs were last given to. */
  private typedefsInstalledIn: Scope | null = null;
  /** The calls being executed, innermost last, for the library to read. */
  private readonly calls: UniMethodCall[] = [];
  /** What the library call being executed has stored so far. */
  private libraryWrites: LibraryWrite[] = [];
  /** Whether the program names `errno`, which decides whether it is drawn. */
  private usesErrno = false;
  /** `errno`'s object, when the program names it; its value otherwise. */
  private errnoAddress: number | null = null;
  private errnoValue = 0;
  /** The standard streams the program names, which are drawn as objects. */
  private namedStreams: string[] = [];
  /** This run's `<stdio.h>`: its streams and the files it has open. */
  private stdio: StdioRuntime | null = null;
  /** The program's file system: the uploaded files and those it made. */
  private fileSystem = new Map<string, ArrayBuffer>();
  /** Whether the console ended standard input with its last answer. */
  private inputEnded = false;
  /** The spans of the program's output that it wrote to `stderr`. */
  private readonly errorOutput: OutputSpan[] = [];
  /** Maps a line of the executed source back to its file; see `setSourceLocator`. */
  private sourceLocator: SourceLocator | null = null;
  /** The source as typed, and its macro expansions, for `assert`'s text. */
  private sourceText = '';
  private sourceExpansions: Expansion[] = [];
  private entryPoint: UniFunctionDec | null = null;
  /** `argv[0]` and the arguments after it; see `setProgramArguments`. */
  private programArguments: string[] = ['main'];
  /**
   * What `main`'s parameters are bound to when its block starts, set while
   * the library loads for a `main` that takes them; see `ProgramArguments`.
   */
  private mainArguments: {
    names: { argc: string; argv: string };
    argc: number;
    argv: number;
  } | null = null;
  /** The functions the program defines with `...`; see `Variadic.ts`. */
  private variadicFunctions = new Set<string>();
  /** The unnamed arguments of a call, until the callee's frame files them. */
  private pendingVarargs: {
    dec: UniFunctionDec;
    args: { type: string; value: unknown }[];
  } | null = null;
  /** The frames of the `...` functions being executed, innermost last. */
  private readonly variadicFrames: (VariadicFrame & { scope: Scope })[] = [];
  private readonly expressions = new ExpressionRecorder();
  private readonly constructs = new ConstructRecorder();
  /** What the run has been told off for, in the order it happened. */
  private readonly runtimeDiagnostics: RuntimeDiagnostic[] = [];
  /**
   * Objects declared with no initializer that nothing has written yet. An
   * object enters only where the source is certain - a local declaration with
   * nothing after the name - and leaves on the first assignment or the first
   * time its address is taken, so a parameter, a global and anything `scanf`
   * was pointed at are never in it.
   */
  private readonly unwritten = new Set<number>();
  /** Addresses already reported, so a read in a loop is said once. */
  private readonly readUnwritten = new Set<number>();
  /** Whether absent initializers currently need C's static-storage zero fill. */
  private zeroFillingStaticStorage = false;
  /**
   * Each function's block-scope `static` declarations, in source order, read
   * from the program about to run; see `declareBlockStatics`.
   */
  private blockStaticSites: { function: string; sites: UniVariableDec[] }[] =
    [];
  /**
   * The objects those declarations name, created once before `main`, keyed by
   * the declaration that names them inside its function.
   */
  private readonly blockStatics = new Map<UniVariableDec, BoundName[]>();
  /** The binary operators being evaluated, innermost last; see `execBinOp`. */
  private readonly operations: {
    op: string;
    types: [string, string] | null;
  }[] = [];
  /** The C type of each expression node, once it has been worked out. */
  private readonly expressionTypes = new WeakMap<object, string | null>();
  /** `rule:line` of every warning `warnOncePerLine` has raised. */
  private readonly warnedLines = new Set<string>();

  /** Installs the record metadata read from the program about to execute. */
  setRecordTables(structs: StructTable, unions: UnionTable): void {
    this.structs = structs;
    this.unions = unions;
    this.recordArrays.clear();
  }

  /**
   * A literal's escape sequences as C reads them (`Escapes.ts`). Upstream's
   * decoder turned `\\` into `/` and every other stray backslash too; this
   * replaces it for every caller that names this class.
   */
  static escapeText(text: string): string {
    return decodedText(text);
  }

  /** `'\\'` is one backslash, not upstream's `/`. */
  protected execCharLiteral(expr: UniCharacterLiteral, _scope: Scope): any {
    const text = decodedText(String(expr.value));
    return text.length === 0 ? 0 : text.charCodeAt(0);
  }

  /** The bytes of a string literal, terminator included. */
  protected execStringLiteral(expr: UniStringLiteral, _scope: Scope): any {
    const text = decodedText(String(expr.value));
    const bytes: number[] = [];
    for (let i = 0; i < text.length; i += 1) {
      bytes.push(text.charCodeAt(i));
    }
    bytes.push(0);
    return bytes;
  }

  setDeclarationSpecifiers(specifiers: DeclarationSpecifiers): void {
    this.declarationSpecifiers = specifiers;
    this.declarationInfoByAddress.clear();
    this.functionAddresses.clear();
    this.functionsByAddress.clear();
    this.libraryFunctionsByAddress.clear();
    this.usedStdioFunctions.clear();
    this.globalScope = null;
    this.entryPoint = null;
  }

  setDesignatedInitializers(initializers: DesignatedInitializers): void {
    this.designatedInitializers = initializers;
  }

  /** Restores member trees that the stock ExecState flattens out of arrays. */
  expandRecordArrays(state: ExecState): ExecState {
    for (const stack of state.getStacks()) {
      for (const variable of stack.getVariables()) {
        const allocation = this.recordArrays.get(variable.address);
        if (typeof allocation === 'undefined') {
          continue;
        }
        const elements = allocation.descriptors.map((descriptor, index) =>
          this.recordVariable(
            allocation.type,
            `${variable.name}[${index}]`,
            descriptor,
            variable.depth,
            allocation.scope
          )
        );
        (variable as any).value = elements;
      }
    }
    this.expandMemberArrays(state);
    return state;
  }

  /**
   * Gives a record's array members their elements. The stock `ExecState`
   * builds each member from the one entry at its offset, so `char name[8]`
   * came out as a single `char`; the record is rebuilt from memory instead,
   * the way `recordVariable` builds the elements of a record array.
   */
  private expandMemberArrays(state: ExecState): void {
    const scope = this.globalScope;
    if (scope === null) {
      return;
    }
    for (const stack of state.getStacks()) {
      for (const variable of stack.getVariables()) {
        const type = variable.type;
        if (
          typeof type !== 'string' ||
          /[*[]/.test(type) ||
          this.recordArrays.has(variable.address) ||
          !Array.isArray(variable.getValue()) ||
          this.tableFor(type) === null ||
          !this.needsOwnLayout(type)
        ) {
          continue;
        }
        const rebuilt = this.recordVariable(
          type,
          variable.name,
          variable.address,
          variable.depth,
          scope
        );
        (variable as any).value = rebuilt.getValue();
      }
    }
  }

  /**
   * Spells the addresses recorded since the last step (`ConstructTrace`'s
   * address marks) with the display addresses this step is drawn at.
   */
  resolveDisplayAddresses(
    state: ExecState,
    display: (address: number) => number | undefined
  ): void {
    this.constructs.resolveAddresses(state, display);
  }

  declarationInfoAt(address: number): RuntimeDeclarationInfo | null {
    const info = this.declarationInfoByAddress.get(address);
    return typeof info === 'undefined' ? null : info;
  }

  /**
   * The mapper represents structs, unions and C++ classes with the same node.
   * Use source-derived layouts for the first two and preserve the stock class
   * behaviour for every node the tables do not recognise.
   */
  protected execClassDec(dec: UniClassDec, scope: Scope): void {
    const runtimeDec = dec as unknown as RuntimeClassDec;
    let name = runtimeDec.className;
    let table = name === null ? null : this.tableFor(name);
    if (name === null && runtimeDec.codeRange !== null) {
      const line = runtimeDec.codeRange.begin.y;
      name = this.structs.nameAtLine(line);
      table = name === null ? null : this.structs;
      if (table === null) {
        name = this.unions.nameAtLine(line);
        table = name === null ? null : this.unions;
      }
    }
    if (table === null || name === null) {
      super.execClassDec(dec, scope);
      return;
    }
    const layout = table.layoutOf(name);
    if (layout === null) {
      super.execClassDec(dec, scope);
      return;
    }
    // The mapper drops the name from `typedef struct { ... } Name`; restoring
    // it lets the inherited typedef path bind Name to this registered layout.
    runtimeDec.className = name;
    const runtimeLayout = this.runtimeLayout(layout, table.membersOf(name));
    for (const runtimeName of table.namesFor(name)) {
      // Scope's typedef map is not inherited by child scopes. Registering the
      // same layout under each alias makes local declarations resolve anyway.
      scope.setTop(runtimeName, runtimeLayout, 'CLASS');
    }
  }

  /** Uses the full descriptor-plus-members stride for an aggregate array. */
  protected *getAddress(expr: UniExpr, scope: Scope): any {
    if (
      expr instanceof UniBinOp &&
      expr.operator === '[]' &&
      !(expr.left instanceof UniIdent)
    ) {
      const element = yield* this.memberArrayAddress(expr, scope);
      if (element !== null) {
        return element;
      }
    }
    if (
      expr instanceof UniBinOp &&
      expr.operator === '[]' &&
      expr.left instanceof UniIdent
    ) {
      const handle = scope.getAddress(expr.left.name);
      const allocation = this.recordArrays.get(handle);
      if (typeof allocation === 'undefined') {
        // The subscript of a plain array or a pointer. The base engine
        // computes base plus index times width whatever the index is, so an
        // index past the end quietly reads the object next to the array.
        const index = Number(
          (yield* this.execExpr(expr.right, scope)).valueOf()
        );
        this.checkSubscript(expr.left.name, index, scope);
        const stride = this.subscriptStride(expr.left, scope);
        if (stride !== null) {
          const base = Number(
            (yield* this.execExpr(expr.left, scope)).valueOf()
          );
          return base + index * stride;
        }
        return yield* super.getAddress(
          new UniBinOp('[]', expr.left, new UniIntLiteral(index)),
          scope
        );
      }
      const index = Number((yield* this.execExpr(expr.right, scope)).valueOf());
      const descriptor = allocation.descriptors[index];
      if (typeof descriptor === 'undefined') {
        this.refuse(
          'array-out-of-bounds',
          `index ${index} is outside the array bounds; valid indices are 0 ` +
            `through ${allocation.descriptors.length - 1}`
        );
      }
      return descriptor;
    }
    if (expr instanceof UniBinOp && expr.operator === '[]') {
      // `(p + 1)[0]`, `pp[1][2]`, `names[i][0]`: the base engine sizes these
      // by the name at the far left and then adds through `+`, which now
      // scales a pointer operand itself, so they are computed here.
      const stride = this.subscriptStride(expr.left, scope);
      if (stride !== null) {
        const base = Number((yield* this.execExpr(expr.left, scope)).valueOf());
        const index = Number(
          (yield* this.execExpr(expr.right, scope)).valueOf()
        );
        if (base === 0) {
          this.refuse(
            'null-dereference',
            `${this.sourceTextOf(expr.left) || 'the pointer'} is a null ` +
              `pointer, so a subscript of it does not designate an object`
          );
        }
        return base + index * stride;
      }
    }
    return yield* super.getAddress(expr, scope);
  }

  /**
   * How far apart, in engine memory, the elements a subscript of this
   * expression steps over are, or null when its type cannot be told.
   *
   * A pointer steps over whole objects of the type it points to: four bytes
   * for an `int` or a `char *`, a descriptor and its members for a record.
   * The base engine stripped every `*` from the name's type first, so a
   * `char **` stepped one byte at a time. An array of arrays is the base
   * engine's own table of rows, whose spacing it chose by the array's name.
   */
  private subscriptStride(expr: UniExpr, scope: Scope): number | null {
    const type = this.pointerTypeOf(expr, scope);
    return type === null ? null : this.pointerStride(type);
  }

  /**
   * The type of an expression of pointer or array type, typedefs resolved,
   * or null for any other expression - a function pointer included, which
   * has no arithmetic.
   */
  private pointerTypeOf(expr: unknown, scope: Scope): string | null {
    const spelled = this.staticTypeOf(expr, scope);
    if (spelled === null) {
      return null;
    }
    const type = scope.getTypedef(spelled.trim()).trim();
    if (isFunctionPointerType(type)) {
      return null;
    }
    return type.endsWith('*') || type.endsWith(']') ? type : null;
  }

  /**
   * How a `+` or `-` with an operand of pointer type is computed, or null
   * when neither operand has one: an integer added to a pointer counts
   * elements, and two pointers subtracted count the elements between them.
   */
  private pointerArithmeticOf(
    op: string,
    left: UniExpr,
    right: UniExpr,
    scope: Scope
  ):
    | { kind: 'offset'; pointer: 'left' | 'right'; stride: number }
    | { kind: 'difference'; stride: number }
    | null {
    if (op !== '+' && op !== '-') {
      return null;
    }
    const leftType = this.pointerTypeOf(left, scope);
    const rightType = this.pointerTypeOf(right, scope);
    if (leftType !== null && rightType !== null) {
      return op === '-'
        ? { kind: 'difference', stride: this.pointerStride(leftType) }
        : null;
    }
    if (leftType !== null) {
      return {
        kind: 'offset',
        pointer: 'left',
        stride: this.pointerStride(leftType),
      };
    }
    if (rightType !== null && op === '+') {
      return {
        kind: 'offset',
        pointer: 'right',
        stride: this.pointerStride(rightType),
      };
    }
    return null;
  }

  /**
   * How many bytes of engine memory one step of a pointer of this type moves:
   * the size of the object it points to. `void *` steps a byte at a time, as
   * gcc lets it. A step over a row of an array of arrays (`m + 1` on an
   * `int m[2][3]`) moves along the engine's table of rows, whose spacing it
   * chose by the row's type name, so `*(*(m + 1) + 2)` is `m[1][2]`.
   */
  private pointerStride(type: string): number {
    const element = elementTypeOf(type);
    if (element.endsWith(']')) {
      return Engine.sizeof(element);
    }
    const size = /^(?:const|volatile|\s)*void$/.test(element)
      ? 1
      : this.engineSizeOf(element);
    return size > 0 ? size : 1;
  }

  /** The value of pointer arithmetic, from the operands' values. */
  private pointerArithmetic(
    op: string,
    l: unknown,
    r: unknown,
    how:
      | { kind: 'offset'; pointer: 'left' | 'right'; stride: number }
      | { kind: 'difference'; stride: number }
  ): any {
    const number = (value: unknown): number =>
      Number((value as { valueOf(): unknown } | null)?.valueOf?.() ?? value);
    const left = number(l);
    const right = number(r);
    if (how.kind === 'difference') {
      return engineValue(Math.trunc((left - right) / how.stride), 'long');
    }
    if (how.pointer === 'left') {
      return op === '+' ? left + right * how.stride : left - right * how.stride;
    }
    return right + left * how.stride;
  }

  /**
   * `sizeof(recordVariable)` must use the source-derived record width, and a
   * function has to survive `&` and `*`.
   *
   * C says `add`, `&add` and `*add` all denote the same function, which is why
   * `int (*op)(int, int) = &add;` and `(*op)(2, 3)` are legal spellings of the
   * plain ones. The stock engine reads `&` as "the address this object was
   * given" and `*` as "the object at this address"; a function is filed under
   * neither rule, so both spellings lose it and the call that follows has
   * nothing to dispatch on.
   */
  protected *execUnaryOp(uniOp: UniUnaryOp, scope: Scope): any {
    if (uniOp.operator === '++' || uniOp.operator === '--') {
      // The stock engine's own spelling of a prefix update, given the same way.
      uniOp.operator = `${uniOp.operator}_`;
    }
    if (INCREMENT_OPERATORS.indexOf(uniOp.operator) !== -1) {
      return yield* this.increment(uniOp, scope);
    }
    // The other half of the gap `BITWISE` fills: unicoen's unary table has no
    // case for `~` either, so `~x` evaluated to null and killed its
    // statement without a word.
    if (uniOp.operator === '~') {
      const value = yield* this.execExpr(uniOp.expr, scope);
      return ~Number(value?.valueOf?.() ?? value);
    }
    // Unary minus negated only an `Int`: its test for anything else compares
    // the value with the string 'number', so `-d` of a double, `-2.5` and
    // `-INFINITY` all fell through and came back unchanged. Unary plus had no
    // case at all.
    if (uniOp.operator === '-' || uniOp.operator === '+') {
      const value = yield* this.execExpr(uniOp.expr, scope);
      if (value instanceof Int) {
        return uniOp.operator === '-' ? new Int(-value) : value;
      }
      const number = Number(value?.valueOf?.() ?? value);
      return uniOp.operator === '-' ? -number : number;
    }
    if (uniOp.operator === '&' && uniOp.expr instanceof UniIdent) {
      const designator = this.functionNamed(uniOp.expr.name, scope);
      if (designator !== null) {
        return this.functionAddressOf(designator, scope);
      }
    }
    if (uniOp.operator === '*') {
      // Evaluated once and not handed on, so `*p++` still increments once.
      const target = yield* this.execExpr(uniOp.expr, scope);
      if (Number(target) === 0) {
        this.refuse(
          'null-dereference',
          'a null pointer does not point to an object that can be dereferenced'
        );
      }
      return this.functionAt(Number(target), scope) === null
        ? scope.getValue(target)
        : target;
    }
    if (uniOp.operator === '&') {
      const address = yield* this.getAddress(uniOp.expr, scope);
      // Whoever was handed the address may write through it, which is what
      // `scanf("%d", &n)` is for.
      this.noteWrite(address);
      const info = this.declarationInfoByAddress.get(address);
      if (info !== undefined && info.region === 'register') {
        this.refuse(
          'register-address',
          'the address operator cannot be applied to an object declared with the register storage-class specifier'
        );
      }
      return address;
    }
    if (uniOp.operator === 'sizeof') {
      const operand = uniOp.expr;
      if (
        operand instanceof UniUnaryOp &&
        operand.operator === '*' &&
        operand.expr instanceof UniIdent &&
        scope.hasType(operand.expr.name)
      ) {
        // Upstream's one side effect, kept: `p = malloc(n * sizeof *p)` is
        // how `malloc` learns what the block it carves will hold.
        Engine.lastSizeOf = scope
          .getTypedef(this.getType(operand.expr, scope) ?? '')
          .replace(/\*+$/, '');
      }
      const type = this.staticTypeOf(operand, scope);
      const size = type === null ? null : this.sizeOfType(type, scope);
      if (size !== null) {
        return new Int(size);
      }
    }
    return yield* super.execUnaryOp(uniOp, scope);
  }

  /**
   * `++` and `--`, prefix and postfix, on any object. The stock engine
   * updated a plain name only - `a[i]++`, `s.x++`, `(*p)++` and `p->n--`
   * evaluated their operand and changed nothing - and added one to a
   * pointer's address, so `p++` on an `int *` pointed into the middle of an
   * element. The operand is evaluated once; a pointer steps over one element.
   */
  private *increment(uniOp: UniUnaryOp, scope: Scope): any {
    const target = uniOp.expr;
    const postfix = uniOp.operator.startsWith('_');
    const step = uniOp.operator.indexOf('++') !== -1 ? 1 : -1;
    const address = yield* this.getAddress(target, scope);
    const current =
      target instanceof UniIdent
        ? yield* this.execExpr(target, scope)
        : scope.getValue(address);
    const pointer = this.pointerTypeOf(target, scope);
    // The store converts to the object's type, which is where an `int`
    // wraps and a `long long` does not.
    const next =
      Number(current?.valueOf?.() ?? current) +
      step *
        (pointer !== null && !pointer.endsWith(']')
          ? this.pointerStride(pointer)
          : 1);
    const stored = this.execAssign(address, next, scope);
    const result = postfix ? current : stored;
    yield result;
    return result;
  }

  /**
   * Where an array member of a record is (`s.name`, `p->grid`), or one of its
   * elements or rows (`s.name[2]`, `p->grid[1]`), or null for any other
   * expression - a plain array's subscript is the stock engine's.
   *
   * The stock engine reads a member as the value at its offset, which for
   * an array is its first element, and sizes a subscript by the type of the
   * name at the far left, which for `s.name[i]` is the record. An array
   * member's elements are laid out one after another (`writeRecord`), so its
   * address and its element width are all a subscript needs.
   */
  private *memberArrayAddress(expr: UniExpr, scope: Scope): any {
    if (
      expr instanceof UniBinOp &&
      (expr.operator === '.' || expr.operator === '->') &&
      expr.right instanceof UniIdent
    ) {
      const type = this.staticTypeOf(expr, scope);
      if (type === null || !type.endsWith(']')) {
        return null;
      }
      return yield* super.getAddress(expr, scope);
    }
    if (!(expr instanceof UniBinOp) || expr.operator !== '[]') {
      return null;
    }
    const arrayType = this.staticTypeOf(expr.left, scope);
    if (arrayType === null || !arrayType.endsWith(']')) {
      return null;
    }
    const base = yield* this.memberArrayAddress(expr.left, scope);
    if (base === null) {
      return null;
    }
    const index = Number((yield* this.execExpr(expr.right, scope)).valueOf());
    const length = scope.getArrayDims(
      arrayType.slice(arrayType.indexOf('['))
    )[0];
    if (length > 0 && (index < 0 || length <= index)) {
      const name = this.sourceTextOf(expr.left) || 'the array';
      this.refuse(
        'array-out-of-bounds',
        `index ${index} is outside the bounds of ${name}; valid indices ` +
          `are 0 through ${length - 1}`
      );
    }
    return base + index * this.engineSizeOf(elementTypeOf(arrayType));
  }

  /** How many bytes of engine memory one object of a type spans. */
  private engineSizeOf(type: string): number {
    const array = /^([^[]*)((?:\[[^\]]*\])+)$/.exec(type.trim());
    if (array !== null) {
      const dimensions = array[2]
        .slice(1, -1)
        .split('][')
        .map((length) => Number(length));
      return dimensions.reduce(
        (total, length) => total * length,
        this.engineSizeOf(array[1])
      );
    }
    const table = type.indexOf('*') === -1 ? this.tableFor(type.trim()) : null;
    return table === null
      ? Engine.sizeof(type)
      : Engine.structInfoSize + table.sizeOf(type.trim());
  }

  /**
   * The type of an expression as the compiler knows it, without evaluating
   * it - `sizeof` must not - or null when it cannot be told from the tree.
   *
   * Upstream's `sizeof` asked the type-name table about whatever word it was
   * handed, so `sizeof arr` and `sizeof d` (a double) both came out as 4,
   * `sizeof(struct Point)` as 4, and `sizeof(a[0])` evaluated the element and
   * then failed. The operand shapes the mapper produces are few: a name (of a
   * variable or of a type), a subscript, a dereference, a member access, a
   * cast or a literal.
   */
  private staticTypeOf(expr: unknown, scope: Scope): string | null {
    if (expr instanceof UniIdent) {
      const name = expr.name;
      const declared = scope.hasType(name) ? scope.getType(name) : null;
      if (declared === 'SYSTEM') {
        const value = scope.get(name);
        return value instanceof Int ? 'int' : 'double';
      }
      if (
        declared !== null &&
        declared !== 'CLASS' &&
        declared !== 'FUNCTION'
      ) {
        return declared;
      }
      return name;
    }
    if (expr instanceof UniCast) {
      return expr.type;
    }
    if (expr instanceof UniStringLiteral) {
      return `char[${PlivetCPP14Engine.escapeText(String(expr.value)).length + 1}]`;
    }
    if (expr instanceof UniCharacterLiteral || expr instanceof UniIntLiteral) {
      // A character constant is an `int` in C.
      return 'int';
    }
    if (expr instanceof UniDoubleLiteral) {
      const spelling = (expr as { plivetSpelling?: string }).plivetSpelling;
      return typeof spelling === 'string' && /[fF]$/.test(spelling)
        ? 'float'
        : 'double';
    }
    if (expr instanceof UniUnaryOp) {
      if (expr.operator === '*') {
        const pointer = this.staticTypeOf(expr.expr, scope);
        return pointer === null
          ? null
          : elementTypeOf(scope.getTypedef(pointer));
      }
      if (expr.operator === '&') {
        const object = this.staticTypeOf(expr.expr, scope);
        return object === null ? null : `${object}*`;
      }
      if (
        expr.operator === '()' ||
        INCREMENT_OPERATORS.indexOf(expr.operator) !== -1
      ) {
        return this.staticTypeOf(expr.expr, scope);
      }
      return null;
    }
    if (expr instanceof UniBinOp) {
      if (expr.operator === '[]') {
        const array = this.staticTypeOf(expr.left, scope);
        return array === null ? null : elementTypeOf(scope.getTypedef(array));
      }
      if (expr.right === null || typeof expr.right === 'undefined') {
        // A postfix `++` or `--`, which the mapper writes without a right.
        return this.staticTypeOf(expr.left, scope);
      }
      if (ASSIGNMENT.test(expr.operator)) {
        return this.staticTypeOf(expr.left, scope);
      }
      if (expr.operator === '+' || expr.operator === '-') {
        // Pointer arithmetic: an array operand decays to a pointer to its
        // first element, and two pointers subtracted give a `ptrdiff_t`.
        const how = this.pointerArithmeticOf(
          expr.operator,
          expr.left,
          expr.right,
          scope
        );
        if (how === null) {
          return null;
        }
        if (how.kind === 'difference') {
          return 'long';
        }
        const pointer = this.pointerTypeOf(
          how.pointer === 'left' ? expr.left : expr.right,
          scope
        )!;
        return pointer.endsWith(']') ? `${elementTypeOf(pointer)}*` : pointer;
      }
      if (
        (expr.operator === '.' || expr.operator === '->') &&
        expr.right instanceof UniIdent
      ) {
        let record = this.staticTypeOf(expr.left, scope);
        if (record === null) {
          return null;
        }
        record = scope.getTypedef(record);
        if (expr.operator === '->') {
          record = elementTypeOf(record);
        }
        return this.memberTypeOf(record, expr.right.name);
      }
    }
    return null;
  }

  /** A member's declared type, array lengths included, or null. */
  private memberTypeOf(record: string, member: string): string | null {
    const name = record.replace(/^\s*(struct|union)\s+/, '').trim();
    const table = this.tableFor(name);
    const found = table?.membersOf(name)?.find((one) => one.name === member);
    if (typeof found === 'undefined') {
      return null;
    }
    return (
      found.type.replace(/^\s*(struct|union)\s+/, '') +
      found.lengths.map((length) => `[${length}]`).join('')
    );
  }

  /**
   * C's `sizeof` of a type spelling, in this engine's widths - the ones the
   * canvas draws objects with - or null for a spelling it cannot place.
   */
  private sizeOfType(spelled: string, scope: Scope): number | null {
    const type = spelled
      .replace(/\b(const|volatile|restrict|static|register)\b/g, '')
      .replace(/^\s*(struct|union|enum)\s+/, '')
      .trim();
    const array = /^([^[]*)((?:\[[^\]]*\])+)$/.exec(type);
    if (array !== null) {
      const dimensions = scope.getArrayDims(array[2]);
      if (dimensions.some((length) => !(length > 0))) {
        return null;
      }
      const element = this.sizeOfType(array[1], scope);
      return element === null
        ? null
        : dimensions.reduce((total, length) => total * length, element);
    }
    if (type.indexOf('*') !== -1 || /^_fp\d+$/.test(type)) {
      return Engine.sizeof('*');
    }
    const table = this.tableFor(type);
    if (table !== null) {
      return table.displaySizeOf(type);
    }
    const library = libraryTypedefIn(type);
    // One the engine was given as a typedef resolves below, like the
    // program's own, which may have replaced it.
    if (library !== null && typeof library.engineType === 'undefined') {
      return library.bytes;
    }
    const record = libraryRecordTypes()[type];
    if (typeof record !== 'undefined') {
      return record.size;
    }
    const resolved = scope.getTypedef(type);
    if (resolved !== type) {
      return this.sizeOfType(resolved, scope);
    }
    if (/^_e\d+$/.test(type)) {
      return 4;
    }
    return /^(?:unsigned|signed)?(?:char|short|int|long|float|double|bool|_Bool)+$/.test(
      type.replace(/\s+/g, '')
    ) ||
      /^(?:unsigned|signed)$/.test(type) ||
      type === ENGINE_LONG_LONG ||
      type === ENGINE_UNSIGNED_LONG_LONG
      ? Engine.sizeof(type)
      : null;
  }

  /**
   * A function used as a value becomes its address on the code segment.
   *
   * `Scope.setTop` files every function there under its name, so the address
   * already exists; what the stock engine yields for the name is the
   * `UniFunctionDec` itself. That object cannot be a variable's value here:
   * `ExecState.makeImple` skips any variable holding a `UniNode`, so
   * `int (*op)(int, int) = add;` would run correctly and then be invisible on
   * the canvas - and a visualizer that cannot show the variable has not
   * really added the type. An address is also what C says a function pointer
   * holds, which makes `op == add`, `(int)op` and a null check fall out for
   * free instead of each needing a rule.
   *
   * Calls are unaffected: `execMethoodCall` reads the name out of the scope
   * itself rather than going through here, so `add(1, 2)` still finds the
   * declaration.
   */
  protected *execExpr(expr: UniExpr, scope: Scope): any {
    if (expr instanceof UniIdent) {
      this.checkRead(expr, scope);
    }
    // `Break`, `Continue` and `Return` are how the engine leaves a statement,
    // so an evaluation that never finishes is ordinary; what the recorder was
    // told is starting has to be closed either way.
    const marks = this.constructs.begins(expr);
    let value: any;
    try {
      value = yield* super.execExpr(expr, scope);
    } catch (error) {
      // The stock function runner catches every exception, including an
      // unsupported or malformed statement, and then reports ordinary EOF.
      // Preserve C's own control-flow exceptions, and turn every other silent
      // termination into a diagnostic before the runner consumes it.
      if (
        !(error instanceof ControlException) &&
        !this.runtimeDiagnostics.some((diagnostic) => diagnostic.fatal)
      ) {
        this.record(
          'invalid-statement',
          'error',
          'This statement could not be executed.',
          true,
          rangeOfNode(expr) ?? this.currentRange()
        );
      }
      throw error;
    } finally {
      this.constructs.ends(marks);
    }
    const result =
      value instanceof UniFunctionDec
        ? (this.functionAddressOf(value, scope) ?? value)
        : value;
    this.constructs.yields(expr, marks, result);
    this.expressions.capture(expr, result);
    return result;
  }

  protected *execIf(statement: UniIf, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'if');
    try {
      return yield* super.execIf(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *execFor(statement: UniFor, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'for');
    try {
      return yield* super.execFor(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  /**
   * `UniDoWhile` extends `UniWhile`, and the stock dispatch tests the base
   * class first, so a do-while arrives here too. Only the label differs: what
   * the engine does with either is what this override is wrapping.
   */
  protected *execWhile(statement: UniWhile, scope: Scope): any {
    const depth = this.constructs.entered(
      statement,
      statement instanceof UniDoWhile ? 'doWhile' : 'while'
    );
    try {
      return yield* super.execWhile(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *execSwitch(statement: UniSwitch, scope: Scope): any {
    const depth = this.constructs.entered(statement, 'switch');
    try {
      return yield* super.execSwitch(statement, scope);
    } finally {
      this.constructs.leftAt(depth);
    }
  }

  protected *stopByYield(ret: any, nextExpr: UniExpr): any {
    this.expressions.beforeYield(this.currentState, nextExpr, (call) =>
      this.parametersCalledBy(call)
    );
    this.constructs.attach(this.currentState);
    return yield* super.stopByYield(ret, nextExpr);
  }

  /**
   * The parameters a call in the statement about to run will bind, so an
   * argument's own view can name the one it initialises.
   *
   * Functions are declared at file scope, so the global scope answers every
   * call this can answer at all: a call through a pointer and a library
   * function both resolve to nothing here, and the view falls back to the
   * argument's position.
   */
  private parametersCalledBy(call: UniMethodCall): string[] {
    const scope = this.globalScope;
    if (scope === null) {
      return [];
    }
    const declaration = this.declarationCalledBy(call, scope);
    return declaration === null ? [] : parameterNames(declaration);
  }

  stepExecute(): ExecState {
    const state = this.advance();
    if (!this.isStepExecutionRunning()) {
      this.expressions.finish(state);
      this.constructs.finish(state);
    }
    return state;
  }

  /**
   * Upstream's `Engine.stepExecute`, minus what made a step cost the engine's
   * whole address space and a quadratic deep copy (`StateSnapshot.ts`), and
   * minus the `console.log` of every step's stacks.
   */
  private advance(): ExecState {
    const engine = this as unknown as SteppingEngine;
    if (engine.execStepItr === null || engine.execStepItr === undefined) {
      return this.getCurrentState();
    }
    engine.isSetNextExpr = false;
    let node: IteratorResult<unknown>;
    do {
      node = engine.execStepItr.next();
    } while (!node.done && !engine.isSetNextExpr && !engine.isWaitingForStdin);
    this.currentState.setCurrenValue(node.value);
    if (node.done) {
      engine.execStepItr = null;
    }
    makeState(this.currentState);
    return snapshotOf(this.currentState);
  }

  protected *executeStepByStep(dec: UniProgram): any {
    this.entryPoint = this.getEntryPoint(dec);
    this.sourceStrings = stringLiteralsIn(dec);
    this.usedStdioFunctions = usedStdioFunctionsIn(dec);
    this.usesErrno = mentions(dec, 'errno');
    this.namedStreams = STANDARD_STREAMS.filter((name) => mentions(dec, name));
    this.variadicFunctions = variadicFunctionsIn(this.sourceText);
    this.pendingVarargs = null;
    this.variadicFrames.length = 0;
    this.heapRequests.clear();
    this.recordBlocks.clear();
    this.blockStatics.clear();
    this.blockStaticSites = this.blockStaticDeclarationsIn(dec);
    this.constructs.reset(dec, this.entryPoint);
    const value = yield* super.executeStepByStep(dec);
    // Returning from `main` and calling `exit` both flush every open stream.
    this.stdio?.closeAll();
    return value;
  }

  /**
   * Calls through a function pointer, in either spelling.
   *
   * `op(2, 3)` reaches the stock engine as a call whose name resolves to a
   * number, and `(*op)(2, 3)`, `(*ops[1])(7, 3)` and `(*o.fn)(2, 3)` reach it
   * as a call whose `methodName` is the dereference rather than an identifier;
   * the stock engine reads `mc.methodName.name` unconditionally and looks up a
   * variable called `undefined`. Both need the callee turned back into the
   * function its address stands for.
   */
  protected *execMethoodCall(mc: UniMethodCall, scope: Scope): any {
    const depth = this.constructs.calling(
      mc,
      this.declarationCalledBy(mc, scope)
    );
    // A library function is handed values only; `assert` needs the text of
    // its argument and a diagnostic is best placed on the call itself.
    this.calls.push(mc);
    const outerWrites = this.libraryWrites;
    this.libraryWrites = [];
    try {
      if (mc.receiver !== null) {
        return yield* super.execMethoodCall(mc, scope);
      }
      const callee =
        (yield* this.calleeOf(mc, scope)) ??
        this.variadicCallee(mc, scope) ??
        this.arrayParameterCallee(mc, scope);
      if (callee === null) {
        return yield* super.execMethoodCall(mc, scope);
      }
      const args: any[] = [];
      for (const arg of mc.args) {
        args.push(yield* this.execExpr(arg, scope));
      }
      return yield* this.callDefined(callee, scope, args, mc.args);
    } finally {
      const writes = this.libraryWrites;
      this.libraryWrites = outerWrites;
      if (writes.length > 0) {
        this.recordLibraryWrites(mc, writes);
      }
      this.calls.pop();
      this.constructs.leftAt(depth);
    }
  }

  /**
   * A direct call of a function the program defines with `...`. The stock
   * call binds arguments to parameters one for one and fails on the first
   * argument with no parameter, so these calls are made here instead.
   */
  private variadicCallee(
    mc: UniMethodCall,
    scope: Scope
  ): UniFunctionDec | null {
    const declaration = this.declarationCalledBy(mc, scope);
    return declaration !== null && this.variadicFunctions.has(declaration.name)
      ? declaration
      : null;
  }

  /**
   * Calls a function the program defines. For a `...` function the named
   * parameters are bound as usual, and the rest of the arguments wait in
   * `pendingVarargs`, with their promoted types, for `execBlock` to file them
   * in the new frame.
   */
  private *callDefined(
    callee: UniFunctionDec,
    scope: Scope,
    args: any[],
    expressions: unknown[]
  ): any {
    let bound = args;
    if (this.variadicFunctions.has(callee.name)) {
      const named = (callee.params ?? []).length;
      bound = args.slice(0, named);
      this.pendingVarargs = {
        dec: callee,
        args: args
          .slice(named)
          .map((value, i) =>
            this.variadicArgument(expressions[named + i], value, scope)
          ),
      };
    }
    return yield* (this as unknown as DispatchingEngine).execFunc(
      this.adjustedParameters(callee),
      scope,
      bound
    );
  }

  /**
   * A direct call of a function with a parameter declared as an array, which
   * is made here so the parameter is bound as the pointer C adjusts it to;
   * see `adjustedParameters`.
   */
  private arrayParameterCallee(
    mc: UniMethodCall,
    scope: Scope
  ): UniFunctionDec | null {
    const declaration = this.declarationCalledBy(mc, scope);
    return declaration !== null &&
      this.adjustedParameters(declaration) !== declaration
      ? declaration
      : null;
  }

  /**
   * A function as it binds its arguments: a parameter declared as an array
   * of `T` - `int a[]`, `int a[10]`, `char *argv[]` - is a pointer to `T`
   * (C11 6.7.6.3p7). The stock call bound it as a `T`, so `a + 1` moved one
   * byte, `sizeof a` was an element's size, and the canvas drew a number
   * where an arrow belongs. Only the outermost dimension is adjusted, and a
   * parameter of more than one dimension is left as the engine binds it.
   */
  private adjustedParameters(dec: UniFunctionDec): UniFunctionDec {
    const known = this.adjustedDeclarations.get(dec);
    if (typeof known !== 'undefined') {
      return known;
    }
    const isArray = (variable: { typeSuffix?: string | null }): boolean =>
      typeof variable.typeSuffix === 'string' &&
      /^\[[^\]]*\]$/.test(variable.typeSuffix.trim());
    const params = dec.params ?? [];
    let adjusted = dec;
    if (params.some((param) => param.variables.some(isArray))) {
      adjusted = Object.create(dec, {
        params: {
          value: params.map((param) =>
            param.variables.some(isArray)
              ? {
                  ...param,
                  variables: param.variables.map((variable) =>
                    isArray(variable)
                      ? {
                          ...variable,
                          name: `*${variable.name}`,
                          typeSuffix: null,
                        }
                      : variable
                  ),
                }
              : param
          ),
        },
      }) as UniFunctionDec;
    }
    this.adjustedDeclarations.set(dec, adjusted);
    return adjusted;
  }

  /** One unnamed argument: its type after the default argument promotions. */
  private variadicArgument(
    expr: unknown,
    value: unknown,
    scope: Scope
  ): { type: string; value: unknown } {
    const resolve = (type: string): string => scope.getTypedef(type);
    const type =
      argumentTypeOf(expr, {
        staticTypeOf: (node) => this.staticTypeOf(node, scope),
        declaredTypeOf: (name) =>
          scope.hasType(name) ? scope.getType(name) : null,
        returnTypeOf: (call) =>
          this.declarationCalledBy(call, scope)?.returnType ?? null,
        resolve,
      }) ?? typeOfValue(value, (address) => scope.objectOnMemory.has(address));
    const base = resolve(type)
      .replace(/\[[^\]]*\]/g, '')
      .trim();
    if (base.indexOf('*') === -1 && this.tableFor(base) !== null) {
      this.refuse(
        'variadic-record',
        `a structure or union passed as an unnamed argument (after the ...) ` +
          `is not supported by this visualizer; pass a pointer to it instead`
      );
    }
    return promotedArgument(type, value, resolve);
  }

  /**
   * A `...` function's frame: the unnamed arguments are filed after the
   * named parameters and before the body's locals, as rows named `...[0]`,
   * `...[1]`, so a `va_list` can point at them one after another. The block
   * scope the body opens leaves a byte with no object after the last of
   * them, which is where a `va_list` that has read them all points.
   */
  protected *execBlock(block: UniBlock, scope: Scope): any {
    const main = this.mainArguments;
    if (main !== null && block === this.entryPoint?.block) {
      // unicoen calls `main` with no arguments, so its parameters are bound
      // here, in its frame, as its body starts. `char *argv[]` is a
      // `char **` as a parameter, and is bound as one.
      this.mainArguments = null;
      scope.setTop(main.names.argc, new Int(main.argc), 'int');
      scope.setTop(main.names.argv, main.argv, 'char**');
    }
    const pending = this.pendingVarargs;
    if (pending === null || pending.dec.block !== block) {
      return yield* super.execBlock(block, scope);
    }
    this.pendingVarargs = null;
    const named = parameterNames(pending.dec);
    const frame: VariadicFrame & { scope: Scope } = {
      function: scope.name,
      last: named.length === 0 ? null : named[named.length - 1],
      args: [],
      end: 0,
      scope,
    };
    pending.args.forEach(({ type, value }, i) => {
      const name = variadicName(i);
      scope.setTop(name, value, type);
      frame.args.push({
        name,
        address: scope.variableAddress.get(name)!,
        type,
      });
    });
    frame.end = scope.address.stackAddress;
    this.variadicFrames.push(frame);
    try {
      return yield* super.execBlock(block, scope);
    } finally {
      const at = this.variadicFrames.indexOf(frame);
      if (at !== -1) {
        this.variadicFrames.splice(at, 1);
      }
    }
  }

  /**
   * One mutation for everything a library call stored, per object: what the
   * object held before the call and after it, spelled as a string when the
   * object is characters and as its elements otherwise.
   */
  private recordLibraryWrites(mc: UniMethodCall, writes: LibraryWrite[]): void {
    const global = this.globalScope;
    const line = mc.codeRange?.begin.y;
    if (global === null || typeof line !== 'number') {
      return;
    }
    const memory = new Memory(this.libraryHost(global));
    const byObject = new Map<string, LibraryWrite[]>();
    // A block `calloc` has just zeroed, or `realloc` has just copied into,
    // was nobody's before the call: that is an allocation, which the canvas
    // shows, rather than a change to an object. `realloc` notes its move, and
    // the `<stdarg.h>` macros note which argument the list points at.
    for (const write of writes.filter(
      (one) => UNRECORDED_LIBRARY_WRITES.indexOf(one.fn) === -1
    )) {
      const object = memory.objectAt(write.address);
      const argument =
        mc.args.length === 0 ? '' : this.sourceTextOf(mc.args[0]);
      const target =
        object !== null && object.kind === 'object'
          ? object.name
          : `*${argument.replace(/^&/, '')}`;
      byObject.set(target, (byObject.get(target) ?? []).concat([write]));
    }
    for (const [target, cells] of byObject) {
      cells.sort((left, right) => left.address - right.address);
      const characters = cells.every(
        (cell) => /\bchar\b/.test(cell.type) && cell.type.indexOf('*') === -1
      );
      // An address reads as the canvas writes one: `char *` elements that
      // `qsort` swapped, the `va_list` that `va_arg` moved on.
      const addresses = cells.every(
        (cell) => global.getTypedef(cell.type).indexOf('*') !== -1
      );
      const spell = (value: unknown): string =>
        value === null || typeof value === 'undefined'
          ? '?'
          : characters
            ? escapedText(String.fromCharCode(Number(value) & 0xff))
            : addresses
              ? markAddress(Number((value as { valueOf(): unknown }).valueOf()))
              : String(Number((value as { valueOf(): unknown }).valueOf()));
      const spelled = (values: unknown[]): string =>
        characters
          ? `"${values.map(spell).join('')}"`
          : values.length === 1
            ? spell(values[0])
            : `{${values.map(spell).join(', ')}}`;
      this.constructs.libraryWrote(
        target,
        spelled(cells.map((cell) => cell.before)),
        spelled(cells.map((cell) => cell.after)),
        line
      );
    }
  }

  /**
   * The definition a call names, where the program defines one. A library
   * function has no definition to point a tooltip at, and a call through a
   * pointer only resolves by running the expression - which this must not do,
   * because it is asked before the call has begun.
   */
  private declarationCalledBy(
    mc: UniMethodCall,
    scope: Scope
  ): UniFunctionDec | null {
    return mc.receiver === null && mc.methodName instanceof UniIdent
      ? this.functionNamed(mc.methodName.name, scope)
      : null;
  }

  /**
   * The function a call goes through when it goes through a pointer, or null
   * when the stock lookup should handle it.
   *
   * A plain name is only treated as a pointer when it was declared as one.
   * Without that test an ordinary `int` holding a small number would be
   * callable, because the code segment starts at zero and functions sit four
   * bytes apart.
   */
  private *calleeOf(mc: UniMethodCall, scope: Scope): any {
    if (mc.methodName instanceof UniIdent) {
      const name = mc.methodName.name;
      if (
        !scope.hasType(name) ||
        !isFunctionPointerType(scope.getRawType(name))
      ) {
        return null;
      }
      return this.functionAt(Number(scope.get(name)), scope);
    }
    return this.functionAt(
      Number(yield* this.execExpr(mc.methodName, scope)),
      scope
    );
  }

  /**
   * A function pointer is true when it holds an address.
   *
   * An address arrives here as a plain number, which the stock conversion
   * rejects outright - it accepts only booleans and boxed ones. It also reads
   * a boxed number with `obj !== 0`, comparing an object against a primitive,
   * which is true for every value including zero; that is why `if (!op)` and
   * `if (op == 0)` disagree today. Both readings are fixed here because a null
   * check is how a program asks whether a callback was ever set.
   */
  toBool(value: any): boolean {
    if (typeof value === 'number') {
      return value !== 0;
    }
    if (value instanceof Number) {
      return Number(value.valueOf()) !== 0;
    }
    return super.toBool(value);
  }

  /** Where a function sits on the code segment, or null when it is unknown. */
  functionAddressOf(dec: UniFunctionDec, scope?: Scope): number | null {
    const known = this.functionAddresses.get(dec.name);
    if (typeof known !== 'undefined') {
      return known;
    }
    this.indexFunctions(scope);
    const found = this.functionAddresses.get(dec.name);
    return typeof found === 'undefined' ? null : found;
  }

  /**
   * The function this name denotes, or null when it names something else.
   *
   * A variable holding a function pointer resolves to an address, not to a
   * declaration, so the two are already distinct - but a name bound directly
   * to a declaration could still be either. Its own name settles it: C gives a
   * function and a variable in one scope no way to share one.
   */
  /**
   * What an address holds, for the tooltip that wants to say what an
   * assignment replaced. The engine throws for an object nothing has written,
   * which is not an error here - it is the answer, and the fact is left off
   * rather than invented.
   */
  private valueAt(address: number, scope: Scope): unknown {
    try {
      return scope.getValue(address);
    } catch {
      return undefined;
    }
  }

  private functionNamed(name: string, scope: Scope): UniFunctionDec | null {
    if (!scope.hasValue(name)) {
      return null;
    }
    const value = scope.get(name);
    return value instanceof UniFunctionDec && value.name === name
      ? value
      : null;
  }

  /** The name of the function at a code address, for the visualizer. */
  functionNameAt(address: number): string | null {
    const dec = this.functionAt(address);
    if (dec !== null) {
      return dec.name;
    }
    const libraryName = this.libraryFunctionsByAddress.get(address);
    return typeof libraryName === 'undefined' ? null : libraryName;
  }

  /**
   * The string literals the program loaded, as objects.
   *
   * `"hello"` is not a variable and never becomes one: the engine writes its
   * bytes into the low code area as consecutive `char` entries and hands the
   * address to whatever named it, so `ExecState` - which only walks scopes -
   * has never seen them, and a canvas built from it showed a `const char *`
   * pointing at nothing. They are read-only memory, and this is where they are
   * read out of.
   */
  stringLiterals(): StringLiteralLocation[] {
    const written = this.writtenStrings();
    const byText = new Map(written.map((one) => [one.text, one]));
    const literals: StringLiteralLocation[] = [];
    // Source order, and one object per distinct literal: a C implementation is
    // free to pool them, and two copies of `"%d\n"` in the same program are
    // one string in read-only memory rather than two.
    for (const text of this.sourceStrings) {
      const materialized = byText.get(text);
      literals.push({
        address:
          typeof materialized === 'undefined' ? null : materialized.address,
        text: escapedText(text),
        size: text.length + 1,
      });
      byText.delete(text);
    }
    // Anything the engine wrote that the source did not obviously spell - a
    // literal the preprocessor built, say - is still in memory and still worth
    // showing.
    for (const one of byText.values()) {
      literals.push({
        address: one.address,
        text: escapedText(one.text),
        size: one.text.length + 1,
      });
    }
    return literals;
  }

  /**
   * The strings the engine has actually written into the low code area, read
   * back as runs of consecutive `char` bytes.
   */
  private writtenStrings(): { address: number; text: string }[] {
    const scope = this.globalScope;
    if (scope === null) {
      return [];
    }
    const addresses = Array.from(scope.typeOnMemory.entries())
      .filter(
        ([address, type]) => address < STATIC_AREA_BASE && type === 'char'
      )
      .map(([address]) => address)
      .sort((left, right) => left - right);

    const written: { address: number; text: string }[] = [];
    let start: number | null = null;
    let bytes: number[] = [];
    const flush = () => {
      if (start !== null && 0 < bytes.length) {
        written.push({ address: start, text: String.fromCharCode(...bytes) });
      }
      start = null;
      bytes = [];
    };
    let previous: number | null = null;
    for (const address of addresses) {
      if (previous !== null && address !== previous + 1) {
        flush();
      }
      const value = scope.objectOnMemory.get(address);
      const byte =
        value === null || typeof value === 'undefined'
          ? 0
          : Number(value.valueOf());
      if (byte === 0) {
        // The NUL ends this string; the next byte starts another.
        flush();
      } else {
        if (start === null) {
          start = address;
        }
        bytes.push(byte);
      }
      previous = address;
    }
    flush();
    return written;
  }

  /** Plain text-segment entries for the Worker model. */
  functionLocations(): { name: string; address: number; size: number }[] {
    this.indexFunctions();
    const definitions = Array.from(this.functionsByAddress.entries()).map(
      ([address, dec]) => ({
        name: dec.name,
        address,
        size: this.textSizeOf(dec),
      })
    );
    const libraries = Array.from(this.libraryFunctionsByAddress.entries()).map(
      ([address, name]) => ({
        name,
        address,
        size: LIBRARY_FUNCTION_TEXT_SIZE,
      })
    );
    return definitions
      .concat(libraries)
      .sort((left, right) => left.address - right.address);
  }

  /**
   * The library: upstream's registrations, the wrappers `includeStdio` and
   * `includeStdlib` put over them, and then everything `library/` adds.
   *
   * The engine files a program's own functions and globals before it loads
   * the library, so every registration below used to replace a program's own
   * definition of the same name - a student's `strlen` or `div` silently
   * became the library's. What the program declared is put back afterwards.
   */
  protected loadLibarary(global: Scope): void {
    this.globalScope = global;
    this.calls.length = 0;
    this.errnoValue = 0;
    this.errnoAddress = null;
    const declared = new Map(global.variableAddress);
    const declaredTypes = new Map(global.variableTypes);
    super.loadLibarary(global);
    installLibrary(global, this.libraryHost(global));
    for (const [name, address] of declared) {
      if (global.variableAddress.get(name) !== address) {
        global.variableAddress.set(name, address);
        global.variableTypes.set(name, declaredTypes.get(name)!);
      }
    }
    this.installErrno(global);
    this.installProgramArguments(global);
    // A program with no declaration outside its functions reaches here first.
    this.installTypedefs(global);
    this.declareBlockStatics(global);
  }

  /**
   * Gives every block-scope `static` its object before `main` starts, as C
   * does: one object for the whole run, holding its initial value from the
   * first step. Executed where it is written, the declaration made a new local
   * on every call - `static int calls = 0; calls++;` counted 1, 1, 1 - at an
   * address in the frame, and the object left the data segment whenever its
   * function returned.
   *
   * A function's statics share a scope under the global one, so an
   * initializer may take the address of an earlier one. A scope opened under
   * the global one is named `GLOBAL` as well, which is what files these
   * objects with the file-scope ones on the canvas; the scope also says which
   * function declares them (`StaticScope`), which is whose name each one is.
   * Two blocks of one function that both declare `static int i;` get a scope
   * each.
   *
   * An initializer that calls a function or names a local is not a constant
   * expression, and C refuses it; such a declaration is left to run where it
   * is written, as it did before.
   */
  private declareBlockStatics(global: Scope): void {
    for (const { function: owner, sites } of this.blockStaticSites) {
      let holder: Scope | null = null;
      for (const site of sites) {
        if (site.variables.some((def) => callsAnything(def.value))) {
          continue;
        }
        const before = site.variables.map((def) => declaredName(def.name));
        if (
          holder === null ||
          before.some((name) => holder!.variableAddress.has(name))
        ) {
          holder = Scope.createLocal(global);
          (holder as StaticScope).plivetStaticsOf = owner;
        }
        const names = new Set(holder.variableAddress.keys());
        try {
          const run = this.execVariableDec(site, holder);
          let step = run.next();
          while (step.done !== true) {
            step = run.next();
          }
        } catch {
          // Whatever the declaration managed to file is taken back out, so a
          // half-made object is not drawn in the data segment.
          for (const name of Array.from(holder.variableAddress.keys())) {
            if (!names.has(name)) {
              holder.variableAddress.delete(name);
              holder.variableTypes.delete(name);
            }
          }
          continue;
        }
        // The first execution moves a declarator's `*`s onto the type, so the
        // names are read again now that it has run.
        const bound: BoundName[] = [];
        for (const def of site.variables) {
          const name = declaredName(def.name);
          const address = holder.variableAddress.get(name);
          const type = holder.variableTypes.get(name);
          if (typeof address === 'number' && typeof type === 'string') {
            bound.push({ name, address, type });
          }
        }
        this.blockStatics.set(site, bound);
      }
    }
  }

  /**
   * Each function's block-scope declarations with static storage duration, in
   * source order. A structure declared in a function is not entered: its
   * members are not objects of the function.
   */
  private blockStaticDeclarationsIn(
    program: UniProgram
  ): { function: string; sites: UniVariableDec[] }[] {
    const functions: { function: string; sites: UniVariableDec[] }[] = [];
    const children = (node: any): unknown[] =>
      (Array.from(node.fields.keys()) as string[])
        .filter((field) => field !== 'comments' && field !== 'codeRange')
        .map((field) => node[field]);
    const walk = (node: any, found: UniVariableDec[] | null): void => {
      if (node === null || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((child) => walk(child, found));
        return;
      }
      if (typeof node.fields === 'undefined' || node instanceof UniClassDec) {
        return;
      }
      if (node instanceof UniFunctionDec) {
        const own: UniVariableDec[] = [];
        walk(node.block, own);
        if (own.length > 0) {
          functions.push({ function: node.name, sites: own });
        }
        return;
      }
      if (
        found !== null &&
        node instanceof UniVariableDec &&
        this.hasStaticDuration(node)
      ) {
        found.push(node);
        return;
      }
      children(node).forEach((child) => walk(child, found));
    };
    walk(program, null);
    return functions;
  }

  /** Whether a declaration was written with a static-duration storage class. */
  private hasStaticDuration(decVar: UniVariableDec): boolean {
    if (
      Array.isArray(decVar.modifiers) &&
      decVar.modifiers.includes('typedef')
    ) {
      return false;
    }
    return this.storageClassesOf(decVar).some(
      (item) =>
        item === 'static' || item === '_Thread_local' || item === 'thread_local'
    );
  }

  /** The storage-class specifiers a declaration was written with. */
  private storageClassesOf(decVar: UniVariableDec): StorageClass[] {
    const first = decVar.variables[0];
    const written =
      typeof first === 'undefined'
        ? []
        : decVar.variables.flatMap(
            (def) =>
              this.declarationSpecifiers.infoForVariable(
                decVar.codeRange,
                def.codeRange,
                first.codeRange
              )?.storageClasses ?? []
          );
    const modifiers = Array.isArray(decVar.modifiers) ? decVar.modifiers : [];
    return this.uniqueStorageClasses(
      written.concat(
        modifiers.filter((item) => this.isStorageClass(item)) as StorageClass[]
      )
    );
  }

  /**
   * A block declaration that names an object it does not create: a `static`
   * given its object before `main` (`declareBlockStatics`), or an `extern`
   * naming a file-scope object. The name is bound in the block to that object
   * and nothing is allocated or initialized. Running the declaration instead
   * is what restarted a `static` at every call, and what gave
   * `extern int shared;` a zero-filled local the function then wrote to while
   * the file-scope `shared` kept its value.
   *
   * The block lists the names it binds (`AliasingScope`), so the snapshot
   * draws each of these objects once, where it lives.
   */
  private bindsExistingObject(decVar: UniVariableDec, scope: Scope): boolean {
    const bound =
      this.blockStatics.get(decVar) ?? this.externObjects(decVar, scope.global);
    if (bound === null) {
      return false;
    }
    const aliasing = scope as AliasingScope;
    const aliases = aliasing.plivetAliases ?? new Set<string>();
    aliasing.plivetAliases = aliases;
    for (const { name, address, type } of bound) {
      scope.variableAddress.set(name, address);
      scope.variableTypes.set(name, type);
      aliases.add(name);
    }
    return true;
  }

  /**
   * The file-scope objects a block-scope `extern` declaration names, or null
   * when it is not one or names something the program does not define as an
   * object - which is left to run where it is written, as it did before.
   */
  private externObjects(
    decVar: UniVariableDec,
    global: Scope
  ): BoundName[] | null {
    const classes = this.storageClassesOf(decVar);
    if (classes.indexOf('extern') === -1 || this.hasStaticDuration(decVar)) {
      return null;
    }
    const bound: BoundName[] = [];
    for (const def of decVar.variables) {
      const name = declaredName(def.name);
      const address = global.variableAddress.get(name);
      const type = global.variableTypes.get(name);
      if (
        typeof address !== 'number' ||
        typeof type !== 'string' ||
        type === 'FUNCTION' ||
        type === 'SYSTEM'
      ) {
        return null;
      }
      bound.push({ name, address, type });
    }
    return bound;
  }

  /**
   * `uint8_t`, `int16_t` and the library's other typedefs whose width is not
   * the engine's default, given to the engine as typedefs once per run (see
   * `installLibraryTypedefs`).
   *
   * The engine files a program's globals before it loads the library, so this
   * cannot wait for `loadLibarary`: a global `uint8_t buf[4];` would already
   * have been laid out four bytes to an element. The first declaration is the
   * earliest point there is, and it comes before any typedef of the
   * program's own - which then replaces the library's, as C has it.
   */
  private installTypedefs(global: Scope): void {
    if (this.typedefsInstalledIn === global) {
      return;
    }
    this.typedefsInstalledIn = global;
    installLibraryTypedefs(global);
  }

  /**
   * The program's arguments - `argv[0]` first - for the next run: what a
   * `main` declared `int main(int argc, char *argv[])` (or `char **argv`)
   * receives. A `main` without parameters ignores them.
   */
  setProgramArguments(args: readonly string[]): void {
    this.programArguments = args.length === 0 ? ['main'] : [...args];
  }

  /**
   * The strings and the array of pointers `argv` points at, in static
   * storage before `main` starts, for a `main` that takes them; the program
   * that does not is not drawn carrying them. See `ProgramArguments.ts`.
   */
  private installProgramArguments(global: Scope): void {
    this.mainArguments = null;
    const names = mainParameterNames(this.entryPoint);
    if (names === null) {
      return;
    }
    const stored = storeProgramArguments(global, this.programArguments);
    for (const address of stored.addresses) {
      this.declarationInfoByAddress.set(address, {
        storageClasses: [],
        qualifiers: [],
        baseQualifiers: [],
        pointerQualifiers: [],
        region: 'global',
        initialized: true,
        readOnly: false,
      });
    }
    this.mainArguments = { names, argc: stored.argc, argv: stored.argv };
  }

  /**
   * `errno`, as the modifiable `int` object C declares, among the program's
   * globals - but only for a program that names it. Every other program would
   * otherwise carry an object it never mentions on its canvas; for those the
   * value lives here, where `strtol` and the math functions still set it and
   * `strerror(errno)` (which names it) is not possible.
   */
  private installErrno(global: Scope): void {
    if (!this.usesErrno) {
      return;
    }
    if (!global.variableAddress.has('errno')) {
      global.setTop('errno', new Int(0), 'int');
      const address = global.variableAddress.get('errno')!;
      this.declarationInfoByAddress.set(address, {
        storageClasses: [],
        qualifiers: [],
        baseQualifiers: [],
        pointerQualifiers: [],
        region: 'global',
        initialized: false,
        readOnly: false,
      });
    }
    this.errnoAddress = global.variableAddress.get('errno')!;
  }

  /** What `library/` may ask of this engine; see `LibraryHost`. */
  private libraryHost(global: Scope): LibraryHost {
    return {
      global,
      refuse: (rule, message) => this.refuse(rule, message),
      warn: (rule, message) =>
        this.warn(rule, message, this.callRange() ?? this.currentRange()),
      write: (address, value, fn) => this.libraryWrite(address, value, fn),
      isUnwritten: (address) => this.unwritten.has(address),
      currentCall: () => this.calls[this.calls.length - 1] ?? null,
      sourceText: (node) => this.sourceTextOf(node),
      currentLine: () => this.currentLine(),
      sourceLocation: (line) => this.sourceLineOf(line),
      stdout: (text) => this.stdout(text),
      terminate: (status, line, rule, message) => {
        if (line !== '') {
          this.writeLine(line);
        }
        if (typeof rule !== 'undefined') {
          this.record(
            rule,
            'error',
            message ?? '',
            true,
            this.callRange() ?? this.currentRange()
          );
        }
        throw new Exit(status);
      },
      truthy: (value) => {
        if (value === null || typeof value === 'undefined') {
          return false;
        }
        if (Array.isArray(value)) {
          return true;
        }
        return this.toBool(value);
      },
      getErrno: () =>
        this.errnoAddress === null
          ? this.errnoValue
          : Number(global.objectOnMemory.get(this.errnoAddress)?.valueOf()),
      setErrno: (value) => {
        if (this.errnoAddress === null) {
          this.errnoValue = value;
          return;
        }
        this.noteWrite(this.errnoAddress);
        global.objectOnMemory.set(this.errnoAddress, new Int(value));
      },
      isRecordType: (type) =>
        this.tableFor(type) !== null || global.isStructType(type),
      recordSize: (type) => {
        const table = this.tableFor(type);
        return table === null
          ? this.stockRecordSize(type, global)
          : table.displaySizeOf(type);
      },
      recordStride: (type) => {
        const table = this.tableFor(type);
        return (
          Engine.structInfoSize +
          (table === null
            ? this.stockRecordSize(type, global)
            : table.sizeOf(type))
        );
      },
      recordCells: (type, descriptor) =>
        this.recordCells(type, descriptor, global),
      recordOffset: (type, member) => this.recordOffset(type, member),
      recordBlock: (type, block) => this.layOutHeapRecords(type, block, global),
      blockEnd: (start, size) => {
        const laid = this.recordBlocks.get(start);
        const table = laid === undefined ? null : this.tableFor(laid.type);
        return laid === undefined || table === null
          ? start + size
          : Math.max(
              start + size,
              start +
                laid.count * (Engine.structInfoSize + table.sizeOf(laid.type))
            );
      },
      literalAddress: (bytes) => this.literalAddress(bytes, global),
      note: (target, before, after) => {
        const line = this.calls[this.calls.length - 1]?.codeRange?.begin.y;
        if (typeof line === 'number') {
          this.constructs.libraryWrote(target, before, after, line);
        }
      },
      callback: (fn, caller, what) => this.callback(fn, caller, what, global),
      variadicFrame: () => {
        const scope = this.currentScope;
        const frame = this.variadicFrames[this.variadicFrames.length - 1];
        // Block scopes take their function's name, and a nested call of
        // the same function gets a numbered one: the name is the frame.
        return typeof frame === 'undefined' ||
          scope === null ||
          frame.scope.name !== scope.name
          ? null
          : frame;
      },
      variadicFrameAt: (address) => {
        for (let i = this.variadicFrames.length - 1; 0 <= i; i -= 1) {
          const frame = this.variadicFrames[i];
          if (
            frame.end === address ||
            frame.args.some((arg) => arg.address === address)
          ) {
            return frame;
          }
        }
        return null;
      },
    };
  }

  /**
   * A program function a library function calls back, through the pointer
   * it was handed: the function is found now, and the closure calls it as
   * interpreted code, so each statement of it is a step and its frame is on
   * the canvas while it runs. The caller's scope is the one the library call
   * was made from, as for any call.
   */
  private callback(
    fn: unknown,
    caller: string,
    what: string,
    global: Scope
  ): (args: unknown[]) => Generator<unknown, unknown, unknown> {
    const scope = this.currentScope ?? global;
    const address = Number(
      (fn as { valueOf?: () => unknown } | null)?.valueOf?.() ?? fn
    );
    const declaration =
      fn instanceof UniFunctionDec
        ? fn
        : Number.isFinite(address) && address !== 0
          ? this.functionAt(address, scope)
          : null;
    if (declaration === null) {
      this.refuse(
        'invalid-function-pointer',
        address === 0
          ? `${caller} was given a null pointer as ${what}`
          : `${caller} was given ${what} that does not point to a function`
      );
    }
    const spell = (value: unknown): string => {
      const n = Number((value as { valueOf(): unknown }).valueOf());
      return Number.isInteger(n) && n > 0
        ? `0x${n.toString(16).toUpperCase()}`
        : String(n);
    };
    const call = function* (this: PlivetCPP14Engine, args: unknown[]) {
      const depth = this.constructs.calledBack(declaration, args.map(spell));
      try {
        return yield* (this as unknown as DispatchingEngine).execFunc(
          this.adjustedParameters(declaration),
          scope,
          args as any[]
        );
      } finally {
        this.constructs.leftAt(depth);
      }
    };
    return (args) => call.call(this, args);
  }

  /** The span of the library call being executed, for its diagnostics. */
  private callRange(): RuntimeDiagnostic | null {
    const call = this.calls[this.calls.length - 1];
    return typeof call === 'undefined' ? null : rangeOfNode(call);
  }

  /**
   * One store by a library function: what an assignment does to memory, the
   * canvas and the uninitialised-read check, without the assignment's own
   * record in the construct trace - the call is the construct there.
   */
  private libraryWrite(address: number, value: unknown, fn: string): void {
    const global = this.globalScope!;
    const before = global.objectOnMemory.get(address);
    if (!global.objectOnMemory.has(address)) {
      this.refuse(
        'invalid-pointer',
        `${fn} would write to memory that belongs to no object`
      );
    }
    if (address < STATIC_AREA_BASE) {
      this.refuse(
        'string-literal-modification',
        `${fn} would modify a string literal, which cannot be modified; ` +
          `copy it into a char array first`
      );
    }
    const info = this.declarationInfoByAddress.get(address);
    const type = global.typeOnMemory.get(address) ?? '';
    if (info !== undefined && this.constBindsObject(info, type)) {
      this.refuse(
        'read-only-assignment',
        `${fn} attempts to modify a const-qualified object`
      );
    }
    // Asked before `noteWrite` forgets it: what an unwritten object held
    // was never a value.
    const unwritten = this.unwritten.has(address);
    this.noteWrite(address);
    global.objectOnMemory.set(address, value);
    // Kept once per address: a cell written twice in one call (strtok over
    // its own terminator) changed from its first value to its last.
    const earlier = this.libraryWrites.find((one) => one.address === address);
    if (typeof earlier === 'undefined') {
      this.libraryWrites.push({
        address,
        fn,
        type: global.typeOnMemory.get(address) ?? '',
        before: unwritten ? null : before,
        after: value,
      });
    } else {
      earlier.after = value;
    }
  }

  /**
   * Where a string literal is in read-only memory: the existing copy when
   * the engine already wrote one, otherwise a new one written now, so a
   * pointer into it has something to point at.
   */
  private literalAddress(bytes: number[], global: Scope): number {
    const end = bytes.indexOf(0);
    const text = String.fromCharCode(
      ...(end === -1 ? bytes : bytes.slice(0, end))
    );
    const existing = this.writtenStrings().find((one) => one.text === text);
    if (typeof existing !== 'undefined') {
      return existing.address;
    }
    const address = global.address.codeAddress;
    for (const byte of Array.from(text, (c) => c.charCodeAt(0)).concat([0])) {
      global.typeOnMemory.set(global.address.codeAddress, 'char');
      global.objectOnMemory.set(global.address.codeAddress, byte);
      global.address.codeAddress += 1;
    }
    return address;
  }

  /** The scalar members of a record object, nested records walked into. */
  private recordCells(
    type: string,
    descriptor: number,
    global: Scope
  ): RecordCell[] {
    const cells: RecordCell[] = [];
    const memberBase = Number(global.objectOnMemory.get(descriptor));
    const table = this.tableFor(type);
    const layout =
      table === null
        ? (global.get(global.getTypedef(type)) as FieldOffset)
        : table.layoutOf(type);
    if (!Number.isFinite(memberBase) || !(layout instanceof Map)) {
      return cells;
    }
    for (const [offset, memberType] of layout.values()) {
      const address = memberBase + offset;
      const nested =
        memberType.indexOf('*') === -1 &&
        (this.tableFor(memberType) !== null || global.isStructType(memberType));
      if (nested) {
        cells.push(...this.recordCells(memberType, address, global));
      } else if (global.objectOnMemory.has(address)) {
        cells.push({ address, type: memberType });
      }
    }
    return cells;
  }

  /** A member's offset as the canvas lays the record out, path and all. */
  private recordOffset(type: string, path: string): number | null {
    let offset = 0;
    let current = type;
    for (const name of path.split('.')) {
      const table = this.tableFor(current);
      const info = table === null ? undefined : table.runtimeTypes()[current];
      const field = info === undefined ? undefined : info.fields[name];
      if (field === undefined) {
        return null;
      }
      offset += field.offset;
      current = field.type.trim();
    }
    return offset;
  }

  /** A record the program does not declare (`div_t`), summed as laid out. */
  private stockRecordSize(type: string, global: Scope): number {
    try {
      const layout = global.get(global.getTypedef(type));
      if (!(layout instanceof Map)) {
        return 0;
      }
      let size = 0;
      for (const [, , width] of layout.values()) {
        size += width;
      }
      return size;
    } catch {
      return 0;
    }
  }

  /**
   * What the source says at a node, as the reader typed it. The parser's
   * columns are in the preprocessed text, so they are mapped back through
   * the macro expansions first; a node that cannot be placed reads as empty.
   */
  private sourceTextOf(node: unknown): string {
    const range = (node as { codeRange?: any } | null)?.codeRange;
    if (!range || !range.begin || !range.end || this.sourceText === '') {
      return '';
    }
    // The parser's end column is one past the last character, and the map
    // back through the expansions takes an inclusive one.
    const { begin, end } = originalRange(
      { begin: range.begin, end: { x: range.end.x - 1, y: range.end.y } },
      this.sourceExpansions
    );
    const lines = this.sourceText.split('\n');
    if (begin.y === end.y) {
      return (lines[begin.y - 1] ?? '').slice(begin.x, end.x + 1).trim();
    }
    const first = (lines[begin.y - 1] ?? '').slice(begin.x);
    const middle = lines.slice(begin.y, end.y - 1);
    const last = (lines[end.y - 1] ?? '').slice(0, end.x + 1);
    return [first, ...middle, last]
      .map((line) => line.trim())
      .join(' ')
      .trim();
  }

  /**
   * The source the program was read from and what the preprocessor replaced
   * in it, for `assert` to quote its condition as written.
   */
  setSourceText(code: string, expansions: Expansion[]): void {
    this.sourceText = code;
    this.sourceExpansions = expansions;
  }

  /**
   * A function's illustrative code size, measured once. The function index
   * is rebuilt at every step and the measure walks the whole body; it is
   * also what places every function after this one, so it must not change
   * when the engine fills in a `for (;;)`'s missing condition as it runs.
   */
  private textSizeOf(dec: UniFunctionDec): number {
    let size = this.textSizes.get(dec);
    if (typeof size === 'undefined') {
      size = textSizeOf(dec);
      this.textSizes.set(dec, size);
    }
    return size;
  }

  /** The function at a code address, or null when nothing is filed there. */
  functionAt(address: number, scope?: Scope): UniFunctionDec | null {
    this.indexFunctions(scope);
    const dec = this.functionsByAddress.get(address);
    return typeof dec === 'undefined' ? null : dec;
  }

  /**
   * Both directions of the function/address mapping, read out of the scope the
   * functions were filed in. Keyed by name rather than by node, because the
   * step history deep-copies each `ExecState` and a copied declaration is no
   * longer the object that was registered.
   */
  private indexFunctions(scope?: Scope): void {
    const global =
      typeof scope === 'undefined' ? this.globalScope : scope.global;
    if (global === null || typeof global === 'undefined') {
      return;
    }
    this.globalScope = global;
    const definitions: { engineAddress: number; dec: UniFunctionDec }[] = [];
    for (const engineAddress of global.variableAddress.values()) {
      const value = global.objectOnMemory.get(engineAddress);
      if (value instanceof UniFunctionDec) {
        definitions.push({ engineAddress, dec: value });
      }
    }
    definitions.sort((left, right) => left.engineAddress - right.engineAddress);
    const entryPoint = this.entryPoint;
    if (
      entryPoint !== null &&
      !definitions.some(({ dec }) => dec.name === entryPoint.name)
    ) {
      definitions.push({
        engineAddress: Number.MAX_SAFE_INTEGER,
        dec: entryPoint,
      });
    }

    this.functionAddresses.clear();
    this.functionsByAddress.clear();
    this.libraryFunctionsByAddress.clear();
    let address = CODE_SEGMENT_BASE;
    for (const { dec } of definitions) {
      this.functionAddresses.set(dec.name, address);
      this.functionsByAddress.set(address, dec);
      address += this.textSizeOf(dec);
    }
    for (const name of STDIO_FUNCTION_NAMES) {
      if (!this.usedStdioFunctions.has(name)) {
        continue;
      }
      const implementation = global.hasValue(name) ? global.get(name) : null;
      if (typeof implementation !== 'function') {
        continue;
      }
      this.functionAddresses.set(name, address);
      this.libraryFunctionsByAddress.set(address, name);
      address += LIBRARY_FUNCTION_TEXT_SIZE;
    }
  }

  /** Allocates record arrays and retains declaration metadata. */
  protected *execVariableDec(decVar: UniVariableDec, scope: Scope): any {
    // Every declaration reaches here, so this is the earliest and only hook
    // needed to keep hold of the scope the functions were filed in.
    this.globalScope = scope.global;
    this.installTypedefs(scope.global);
    if (scope.global.address.codeAddress === 0) {
      // The code area starts at the null pointer. A program whose first
      // global is `char *msg = "hi";` had its literal written there, so
      // `msg == NULL` held and every null pointer on the canvas pointed at
      // "hi". Nothing is ever filed at address 0.
      scope.global.address.codeAddress = Engine.structInfoSize;
    }
    if (scope !== scope.global && this.bindsExistingObject(decVar, scope)) {
      return null;
    }
    const firstVariable = decVar.variables[0];
    const sourceInfo = decVar.variables.map((def) =>
      typeof firstVariable === 'undefined'
        ? null
        : this.declarationSpecifiers.infoForVariable(
            decVar.codeRange,
            def.codeRange,
            firstVariable.codeRange
          )
    );
    const arrayDimensions = decVar.variables.map((def) =>
      def.typeSuffix === null ? [] : scope.getArrayDims(def.typeSuffix)
    );
    // A record with an array member is laid out here rather than by
    // `Scope.setStruct`, which gives each member one entry: see `writeRecord`.
    const ownLayout = (def: { name: string }, index: number): boolean =>
      arrayDimensions[index].length === 0 &&
      decVar.type.indexOf('*') === -1 &&
      !/^[*&]/.test(def.name) &&
      !decVar.modifiers.includes('typedef') &&
      this.tableFor(decVar.type) !== null &&
      this.needsOwnLayout(decVar.type);
    // An array of pointers: see `declarePointerArray`.
    const pointerArray = (def: { name: string }, index: number): boolean =>
      arrayDimensions[index].length > 0 &&
      !decVar.modifiers.includes('typedef') &&
      this.isObjectPointerType(
        decVar.type + '*'.repeat(this.pointerDepthOf(def)),
        scope
      );
    const hasSpecialArray = decVar.variables.some(
      (def, index) =>
        ownLayout(def, index) ||
        pointerArray(def, index) ||
        (arrayDimensions[index].length === 1 &&
          ((decVar.type.indexOf('*') === -1 &&
            !/^[*&]/.test(def.name) &&
            this.tableFor(decVar.type) !== null) ||
            (def.value instanceof UniArray &&
              this.designatedInitializers.hasIn(decVar.codeRange))))
    );
    const staticStorage = this.hasStaticStorage(
      sourceInfo,
      decVar.modifiers,
      scope
    );
    const previousZeroFill = this.zeroFillingStaticStorage;
    this.zeroFillingStaticStorage = staticStorage;
    let value: any = null;
    try {
      if (!hasSpecialArray) {
        value = yield* super.execVariableDec(decVar, scope);
      } else {
        Engine.lastSizeOf = decVar.type;
        for (let index = 0; index < decVar.variables.length; index += 1) {
          const def = decVar.variables[index];
          const dimensions = arrayDimensions[index];
          const table =
            decVar.type.indexOf('*') === -1 && !/^[*&]/.test(def.name)
              ? this.tableFor(decVar.type)
              : null;
          const designated =
            def.value instanceof UniArray &&
            this.designatedInitializers.hasIn(decVar.codeRange);
          if (ownLayout(def, index)) {
            const initializer =
              def.value === null || def.value instanceof UniNoneLiteral
                ? null
                : yield* this.execExpr(def.value, scope);
            value = this.allocateRecord(
              def.name,
              decVar.type,
              initializer,
              staticStorage,
              scope
            );
            continue;
          }
          if (pointerArray(def, index)) {
            const depth = this.pointerDepthOf(def);
            (def as PointerDeclarator).plivetPointers = depth;
            def.name = def.name.replace(/^\*+/, '');
            value = yield* this.declarePointerArray(
              def,
              decVar.type + '*'.repeat(depth),
              dimensions,
              designated ? decVar.codeRange : null,
              scope
            );
            continue;
          }
          if (dimensions.length !== 1 || (table === null && !designated)) {
            const single = new UniVariableDec(decVar.modifiers, decVar.type, [
              def,
            ]);
            value = yield* super.execVariableDec(single, scope);
            continue;
          }

          let elements: any[];
          if (def.value instanceof UniArray) {
            const evaluated = yield* this.execExpr(def.value, scope);
            elements = this.designatedInitializers.order(
              decVar.codeRange,
              def.value,
              evaluated,
              dimensions[0],
              table === null ? 0 : []
            );
          } else {
            elements = Array.from(new Array(dimensions[0]), () => null);
          }
          if (table === null) {
            while (def.name.startsWith('*')) {
              def.name = def.name.substring(1);
              decVar.type += '*';
            }
            while (def.name.startsWith('&')) {
              def.name = def.name.substring(1);
              decVar.type += '&';
            }
            value = elements;
            scope.setTop(def.name, value, decVar.type);
          } else {
            value = this.allocateRecordArray(
              def.name,
              decVar.type,
              def.typeSuffix,
              elements,
              scope
            );
          }
        }
        Engine.lastSizeOf = '';
      }
    } finally {
      this.zeroFillingStaticStorage = previousZeroFill;
    }
    if (staticStorage) {
      for (const def of decVar.variables) {
        if (def.value !== null && !(def.value instanceof UniNoneLiteral)) {
          continue;
        }
        const address = scope.variableAddress.get(def.name);
        if (typeof address !== 'undefined') {
          this.zeroInitializeRecord(decVar.type, address, scope);
        }
      }
    }
    for (let index = 0; index < decVar.variables.length; index += 1) {
      const def = decVar.variables[index];
      const sourceDeclaration = sourceInfo[index];
      const declaration =
        sourceDeclaration === null
          ? {
              storageClasses: [],
              qualifiers: [],
              baseQualifiers: [],
              pointerQualifiers: [],
            }
          : sourceDeclaration;
      const storageClasses = this.uniqueStorageClasses(
        declaration.storageClasses.concat(
          decVar.modifiers.filter((item) =>
            this.isStorageClass(item)
          ) as StorageClass[]
        )
      );
      const address = scope.variableAddress.get(def.name);
      if (typeof address === 'undefined') {
        continue;
      }
      const info: RuntimeDeclarationInfo = {
        storageClasses,
        qualifiers: declaration.qualifiers,
        baseQualifiers: declaration.baseQualifiers,
        pointerQualifiers: declaration.pointerQualifiers,
        // Present only where the rewrite reduced a type the mapper could not
        // read, so the canvas spells `long long` over an engine holding a
        // `long`.
        declaredType: declaration.declaredType,
        region: this.storageRegion(storageClasses, scope),
        initialized:
          def.value !== null && !(def.value instanceof UniNoneLiteral),
        readOnly: false,
      };
      info.readOnly = this.constBindsObject(info, scope.getRawType(address));
      this.declarationInfoByAddress.set(address, info);
      const recordArray = this.recordArrays.get(address);
      if (typeof recordArray !== 'undefined') {
        for (const descriptor of recordArray.descriptors) {
          this.declarationInfoByAddress.set(descriptor, info);
          this.registerRecordFields(decVar.type, descriptor, info);
        }
        continue;
      }
      this.registerRecordFields(decVar.type, address, info);
      if (def.typeSuffix !== null && def.typeSuffix !== '') {
        const arrayAddress = scope.objectOnMemory.get(address);
        if (typeof arrayAddress === 'number') {
          const dimensions = scope.getArrayDims(def.typeSuffix);
          const count = dimensions.reduce((total, length) => total * length, 1);
          // An array of pointers keeps its `*`s on the declarator.
          const elementSize = Engine.sizeof(
            decVar.type + '*'.repeat(this.pointerDepthOf(def))
          );
          for (let element = 0; element < count; element += 1) {
            this.declarationInfoByAddress.set(
              arrayAddress + element * elementSize,
              info
            );
          }
        }
      }
    }
    for (const def of decVar.variables) {
      this.retypeRecordBlock(def.name.replace(/^[*&]+/, ''), scope);
    }
    this.noteDeclaration(decVar, scope);
    return value;
  }

  /**
   * How many `*` a declarator adds to its declaration's type. The mapper
   * writes them on the name (`*names`); the first execution moves them off
   * it, and the declarator keeps the count for the next one.
   */
  private pointerDepthOf(def: { name: string }): number {
    const written = /^\**/.exec(def.name)![0].length;
    return written + ((def as PointerDeclarator).plivetPointers ?? 0);
  }

  /** Whether a type is a pointer to an object, typedefs resolved. */
  private isObjectPointerType(type: string, scope: Scope): boolean {
    const resolved = scope.getTypedef(type.trim()).trim();
    return resolved.endsWith('*') && !isFunctionPointerType(resolved);
  }

  /**
   * An array of pointers: `char *names[] = {"ann", "bob", "cy"};`,
   * `int *ps[3];`.
   *
   * The stock `Scope.setTop` takes any `char *` given an array of values for
   * a string literal being stored, so `char *names[3]` became one `char *`
   * holding the bytes of the initializers - `sizeof names` was 4 and
   * `names[1]` read a character. Each element is laid out as an array
   * element of the pointer type instead, which is what the stock path does
   * for every other pointer type, and a string literal in the initializer
   * becomes the address of that literal in read-only memory, as C stores it.
   */
  private *declarePointerArray(
    def: { name: string; value: UniExpr | null; typeSuffix: string },
    type: string,
    dimensions: number[],
    designatedIn: UniVariableDec['codeRange'] | null,
    scope: Scope
  ): any {
    const initialized =
      def.value !== null && !(def.value instanceof UniNoneLiteral);
    let given: unknown[] | null = null;
    if (initialized) {
      const evaluated = yield* this.execExpr(def.value as UniExpr, scope);
      const converted = this.pointerInitializer(def.value, evaluated, scope);
      given = Array.isArray(converted) ? converted : [converted];
      if (designatedIn !== null && def.value instanceof UniArray) {
        given = this.designatedInitializers.order(
          designatedIn,
          def.value,
          given,
          dimensions[0],
          0
        );
      }
    }
    const lengths = dimensions.slice();
    if (!(lengths[0] > 0)) {
      const row = lengths.slice(1).reduce((total, length) => total * length, 1);
      const count = given === null ? 0 : placedCount(given, lengths.slice(1));
      lengths[0] = Math.max(1, Math.ceil(count / row));
    }
    const flat =
      given === null
        ? new Array(lengths.reduce((total, length) => total * length, 1)).fill(
            undefined
          )
        : placedInitializer(given, lengths);
    const elements = flat.map((element) =>
      typeof element === 'undefined'
        ? initialized
          ? 0
          : this.randInt32()
        : element
    );
    let nested: unknown[] = elements;
    for (const length of lengths.slice(1).reverse()) {
      const rows: unknown[] = [];
      for (let at = 0; at < nested.length; at += length) {
        rows.push(nested.slice(at, at + length));
      }
      nested = rows;
    }
    const internals = scope as unknown as ScopeInternals;
    const address = internals.setArray(nested, type, lengths.slice(1));
    internals.setPrimitiveOnCode(
      def.name,
      address,
      `${type}[${lengths.join('][')}]`
    );
    return nested;
  }

  /**
   * An initializer of an array of pointers with every string literal in it
   * replaced by the literal's address. The engine evaluates `"ann"` to its
   * bytes, which is right for `char s[] = "ann"` and wrong for a pointer.
   */
  private pointerInitializer(
    node: unknown,
    value: unknown,
    scope: Scope
  ): unknown {
    if (node instanceof UniStringLiteral && Array.isArray(value)) {
      return this.literalAddress(value as number[], scope.global);
    }
    if (node instanceof UniArray && Array.isArray(value)) {
      return value.map((item, at) =>
        this.pointerInitializer(node.items[at], item, scope)
      );
    }
    return value;
  }

  /**
   * `struct Point *p = malloc(sizeof(struct Point));` as `p = malloc(...)`
   * already has it: the block's first word typed as the record, its members
   * as themselves.
   *
   * Upstream's declaration path types every word of a fresh block as the
   * pointee, which for a record stamps the record's own type over each of its
   * members - one per four bytes of the block's size. `sizeof(struct Point)`
   * used to come out as 4, so only the first member was hit; with the real
   * size every member was. `Engine.execAssign` does this properly for an
   * assignment, and this is the same treatment for a declaration.
   */
  private retypeRecordBlock(name: string, scope: Scope): void {
    const address = scope.variableAddress.get(name);
    const type =
      typeof address === 'undefined'
        ? ''
        : (scope.variableTypes.get(name) ?? '');
    if (typeof address === 'undefined' || !type.endsWith('*')) {
      return;
    }
    const block = Number(scope.objectOnMemory.get(address)?.valueOf());
    const pointee = scope.getTypedef(type.slice(0, -1).trim());
    if (
      !Number.isFinite(block) ||
      !scope.isMallocArea(block) ||
      pointee.indexOf('*') !== -1 ||
      !scope.isStructType(pointee)
    ) {
      return;
    }
    const layout = scope.get(pointee);
    if (!(layout instanceof Map)) {
      return;
    }
    const size = scope.getMallocSize(block);
    scope.typeOnMemory.set(block, pointee);
    for (let offset = Engine.structInfoSize; offset < size; offset += 1) {
      if (!scope.objectOnMemory.has(block + offset)) {
        scope.typeOnMemory.delete(block + offset);
      }
    }
    for (const [memberOffset, memberType] of layout.values()) {
      const at = block + Engine.structInfoSize + memberOffset;
      if (scope.objectOnMemory.has(at)) {
        scope.typeOnMemory.set(at, memberType);
      }
    }
    // Upstream's declaration path has just typed the block a word at a time
    // as the record, over the members of every record it reached.
    this.layOutHeapRecords(pointee, block, scope, true);
  }

  /**
   * A heap block a record pointer has taken, laid out as the records it has
   * room for: `malloc(n * sizeof(struct P))`, `calloc(n, sizeof(struct P))`
   * and a `realloc` of either hold n records, one after another, each laid
   * out as `writeRecord` lays out a declared one - a descriptor word and its
   * members, every element of an array member included. Returns where the
   * records' descriptors are.
   *
   * The stock `malloc` carves one record whatever size it is asked for, and
   * only when the declaration it initializes names a record; given the size
   * by an assignment it carves words. So the block is laid out the first time
   * a record pointer takes it, from the size the program asked for, and the
   * engine's heap cursor moves past the records when the block is the last
   * one carved - a descriptor word per record takes room C's layout does not.
   * A record that already has an entry at every address of its layout keeps
   * its contents: a pointer is assigned the same block many times in a linked
   * list, and `calloc` has already zeroed what the stock `malloc` carved.
   * What the block holds where nothing was written is uninitialized, or zero
   * for `calloc`.
   */
  private layOutHeapRecords(
    type: string,
    block: number,
    scope: Scope,
    retype = false
  ): number[] {
    const name = type.replace(/^\s*(struct|union)\s+/, '').trim();
    const table = name.indexOf('*') === -1 ? this.tableFor(name) : null;
    if (
      table === null ||
      !scope.isMallocArea(block) ||
      !scope.objectOnMemory.has(block)
    ) {
      return [];
    }
    const stride = Engine.structInfoSize + table.sizeOf(name);
    const recordSize = Math.max(1, table.displaySizeOf(name));
    const laid = this.recordBlocks.get(block);
    const requested = this.heapRequests.get(block);
    // A block laid out as records counts its descriptor word in its size, as
    // the stock `malloc` and `realloc` count it.
    const bytes =
      typeof laid !== 'undefined' || typeof requested === 'undefined'
        ? scope.getMallocSize(block) - Engine.structInfoSize
        : requested.bytes;
    let count = Math.max(1, Math.floor(bytes / recordSize));
    const at = (index: number): number => block + index * stride;
    if (
      !retype &&
      typeof laid !== 'undefined' &&
      laid.type === name &&
      laid.count === count
    ) {
      return Array.from({ length: count }, (_, index) => at(index));
    }
    const limit = this.heapLimitOf(block, scope);
    if (at(count) > limit) {
      if (limit === scope.address.heapAddress) {
        scope.address.heapAddress = at(count);
      } else {
        count = Math.max(1, Math.floor((limit - block) / stride));
      }
    }
    const kept =
      !retype && typeof laid !== 'undefined' && laid.type === name
        ? laid.count
        : 0;
    // What lies past the last record is not part of any of them: the words
    // the stock `malloc` carved, or the records a `realloc` shrank away.
    for (let address = at(count); address < limit; address += 1) {
      scope.objectOnMemory.delete(address);
      scope.typeOnMemory.delete(address);
    }
    // Only what `calloc` handed back is zero; a block `realloc` grew in place
    // holds nothing yet in its new records.
    const zeroFill = typeof laid === 'undefined' && requested?.zeroed === true;
    const descriptors: number[] = [];
    for (let index = 0; index < count; index += 1) {
      descriptors.push(at(index));
      if (index >= kept) {
        this.layOutHeapRecord(name, at(index), stride, zeroFill, scope);
      }
    }
    this.recordBlocks.set(block, { type: name, count });
    scope.setMallocSize(block, bytes + Engine.structInfoSize);
    return descriptors;
  }

  /** One record of a heap block; see `layOutHeapRecords`. */
  private layOutHeapRecord(
    type: string,
    descriptor: number,
    stride: number,
    zeroFill: boolean,
    scope: Scope
  ): void {
    const probe = new Map<number, unknown>();
    const types = new Map<number, string>();
    const shadow = {
      ...scope,
      objectOnMemory: probe,
      typeOnMemory: types,
    } as unknown as Scope;
    this.writeRecord(type, descriptor, null, zeroFill, shadow, !zeroFill);
    const laidOut = Array.from(types.keys()).every((address) =>
      scope.objectOnMemory.has(address)
    );
    for (
      let address = descriptor;
      address < descriptor + stride;
      address += 1
    ) {
      const cellType = types.get(address);
      if (laidOut && typeof cellType === 'string') {
        // Upstream's declaration path types the block a word at a time as
        // the record whenever a pointer takes it; the members keep their
        // values, and a descriptor says where its members are.
        scope.typeOnMemory.set(address, cellType);
        if (this.tableFor(cellType) !== null) {
          scope.objectOnMemory.set(address, probe.get(address));
        }
      } else {
        // A word the stock `malloc` carved where the layout has none.
        scope.objectOnMemory.delete(address);
        scope.typeOnMemory.delete(address);
      }
    }
    if (!laidOut) {
      for (const [address, cellType] of types) {
        scope.typeOnMemory.set(address, cellType);
        scope.objectOnMemory.set(address, probe.get(address));
      }
    }
  }

  /** Where the cells of the heap block at `block` end: the next block, or the cursor. */
  private heapLimitOf(block: number, scope: Scope): number {
    let limit = scope.address.heapAddress;
    for (const other of scope.mallocData.keys()) {
      if (block < other && other < limit) {
        limit = other;
      }
    }
    return limit;
  }

  /** Supplies the zero bits C gives every static-storage object. */
  protected randInt32(): number {
    return this.zeroFillingStaticStorage ? 0 : super.randInt32();
  }

  /**
   * Every binary operator is evaluated with the C types of its operands in
   * hand, when they can be told from the tree, so `execBinOpImple` - which
   * only sees the two values - can compute what C computes (`Arithmetic.ts`).
   *
   * One entry per operator being evaluated, innermost last: the operands are
   * evaluated between the push and the call to `execBinOpImple`, and each of
   * their own operators pushes and pops its own entry, so the top is always
   * this operator's. An operator whose types are not known still pushes, so
   * that it never reads an enclosing operator's types.
   */
  protected *execBinOp(
    arg: string | UniBinOp,
    scope: Scope,
    left?: UniExpr,
    right?: UniExpr
  ): any {
    if (
      typeof arg !== 'string' ||
      !(left instanceof UniExpr) ||
      !(right instanceof UniExpr)
    ) {
      return yield* super.execBinOp(arg, scope, left, right);
    }
    if (arg !== '=' && ASSIGNMENT.test(arg)) {
      return yield* this.compoundAssignment(arg, scope, left, right);
    }
    const pointerOperation = this.pointerArithmeticOf(arg, left, right, scope);
    if (pointerOperation !== null) {
      // A string literal evaluates to its bytes; as an operand it is the
      // address of its first character, as `"abc" + 1` needs.
      const address = (value: unknown): unknown =>
        Array.isArray(value)
          ? this.literalAddress(value as number[], scope.global)
          : value;
      const l = address(yield* this.execExpr(left, scope));
      const r = address(yield* this.execExpr(right, scope));
      const result = this.pointerArithmetic(arg, l, r, pointerOperation);
      yield result;
      return result;
    }
    if (arg === '.' || arg === '->' || arg === '[]') {
      // An array member used as a value is its address, as any array is.
      const access = new UniBinOp(arg, left, right);
      const type = this.staticTypeOf(access, scope);
      if (type !== null && type.endsWith(']')) {
        const address = yield* this.memberArrayAddress(access, scope);
        if (address !== null) {
          yield address;
          return address;
        }
      }
    }
    const types = TYPED_OPERATORS.has(arg)
      ? this.operandTypes(left, right, scope)
      : null;
    this.operations.push({ op: arg, types });
    try {
      return yield* super.execBinOp(arg, scope, left, right);
    } finally {
      this.operations.pop();
    }
  }

  /**
   * Every compound assignment, `x += f()` as much as `a[i++] += 1`, `pt.x -=
   * 1`, `p->n *= 2` and `*p /= 2`. The stock engine evaluated the right side
   * once to try the operator and again to compute it - `x += f()` called `f`
   * twice, and `total += va_arg(ap, int)` read two arguments - and reread any
   * target but a plain name by name, which ended the statement. The target
   * and the right side are each evaluated once, as C evaluates them, and the
   * operation is the binary one with the target's type: a pointer target
   * steps over whole elements.
   */
  private *compoundAssignment(
    op: string,
    scope: Scope,
    left: UniExpr,
    right: UniExpr
  ): any {
    const address = yield* this.getAddress(left, scope);
    const operator = op.slice(0, -1);
    // A name is read as an expression, as the stock engine read it, so a
    // read of an object nothing has written is still reported.
    const current =
      left instanceof UniIdent
        ? yield* this.execExpr(left, scope)
        : scope.getValue(address);
    const operand = yield* this.execExpr(right, scope);
    const pointer = this.pointerArithmeticOf(operator, left, right, scope);
    let value: unknown;
    if (pointer !== null && pointer.kind === 'offset') {
      value = this.pointerArithmetic(operator, current, operand, pointer);
    } else {
      const types = this.operandTypes(left, right, scope);
      this.operations.push({ op: operator, types });
      try {
        value = this.execBinOpImple(operator, current, operand);
      } finally {
        this.operations.pop();
      }
    }
    if (value === null || typeof value === 'undefined') {
      this.refuse(
        'invalid-statement',
        `the operator ${op} cannot be applied to these operands`
      );
    }
    const result = this.execAssign(address, value, scope);
    yield result;
    return result;
  }

  /** Both operands' C types, when both are arithmetic and known. */
  private operandTypes(
    left: UniExpr,
    right: UniExpr,
    scope: Scope
  ): [string, string] | null {
    const l = this.arithmeticTypeOf(left, scope);
    const r = this.arithmeticTypeOf(right, scope);
    return l !== null &&
      r !== null &&
      isArithmeticType(l) &&
      isArithmeticType(r)
      ? [l, r]
      : null;
  }

  /**
   * `l op r` with C's conversions, or undefined when a value is not a number
   * and the engine's own rule should have it.
   */
  private typedBinOp(
    op: string,
    l: unknown,
    r: unknown,
    [leftType, rightType]: [string, string]
  ): unknown {
    const numeric = (value: unknown): number | null =>
      typeof value === 'boolean'
        ? Number(value)
        : typeof value === 'number' || value instanceof Number
          ? Number(value.valueOf())
          : null;
    const left = numeric(l);
    const right = numeric(r);
    if (left === null || right === null) {
      return undefined;
    }
    const computed = evaluate(op, left, leftType, right, rightType);
    if (computed === null) {
      return undefined;
    }
    if (computed.divisionByZero) {
      this.refuse(
        'division-by-zero',
        op === '/' ? 'division by zero' : 'remainder of a division by zero'
      );
    }
    const operation =
      `${valueText(left, leftType)} ${op} ` + valueText(right, rightType);
    if (computed.overflow) {
      const wrapped =
        typeof computed.value === 'number'
          ? valueText(computed.value, computed.type)
          : String(computed.value);
      this.warnOncePerLine(
        'signed-overflow',
        `${operation} does not fit in ${computed.type}; signed overflow has ` +
          `undefined behavior, and this run wrapped the result to ${wrapped}`
      );
    }
    if (computed.inexact) {
      this.warnInexact(operation, computed.type);
    }
    if (computed.badShift) {
      this.warnOncePerLine(
        'shift-out-of-range',
        `a shift by ${valueAs(right, rightType)} bits is outside 0 through ` +
          `${(integerTypeInfo(computed.type)?.bits ?? 32) - 1} for ` +
          `${computed.type}, which has undefined behavior`
      );
    }
    return typeof computed.value === 'boolean'
      ? computed.value
      : engineValue(computed.value, computed.type);
  }

  /**
   * The engine holds an integer in a JavaScript number, which is exact only
   * up to 2^53. A `long long` reaches far past that, and a value there is
   * held to the nearest number that can be - so it is said, once per line,
   * rather than shown as if it were exact.
   */
  private warnInexact(what: string, type: string): void {
    this.warnOncePerLine(
      'inexact-integer',
      `${what} is a ${type} beyond 2^53 (9007199254740992); this visualizer ` +
        `computes in JavaScript numbers, which hold integers that large only ` +
        `approximately, so the value shown may be off in its last digits`
    );
  }

  /** A warning raised at most once for each line it is raised on. */
  private warnOncePerLine(rule: string, message: string): void {
    const range = this.currentRange();
    const key = `${rule}:${range?.line}`;
    if (range === null || this.warnedLines.has(key)) {
      return;
    }
    this.warnedLines.add(key);
    this.warn(rule, message, range);
  }

  /**
   * The C type of an expression, canonically spelled (`ExpressionTypes.ts`),
   * or null when the tree does not say: a library call, a call through a
   * pointer, anything the rules below do not cover. Only what the binary
   * operators need is covered; the operators fall back to the engine's
   * untyped arithmetic for anything this cannot type.
   */
  private arithmeticTypeOf(expr: unknown, scope: Scope): string | null {
    if (expr === null || typeof expr !== 'object') {
      return null;
    }
    const known = this.expressionTypes.get(expr);
    if (typeof known !== 'undefined') {
      return known;
    }
    const type = this.computeTypeOf(expr, scope);
    // A node's type is fixed by where it is written; an unknown one is not
    // remembered, in case it was asked before its names were declared.
    if (type !== null) {
      this.expressionTypes.set(expr, type);
    }
    return type;
  }

  private computeTypeOf(expr: object, scope: Scope): string | null {
    if (expr instanceof UniIntLiteral || expr instanceof UniDoubleLiteral) {
      return literalType(
        literalSpelling(expr) ?? String(expr.value),
        expr instanceof UniDoubleLiteral,
        expr.value
      );
    }
    if (expr instanceof UniCharacterLiteral) {
      return 'int';
    }
    if (expr instanceof UniStringLiteral) {
      return 'char *';
    }
    if (expr instanceof UniIdent) {
      return this.identifierTypeOf(expr.name, scope);
    }
    if (expr instanceof UniCast) {
      return this.cTypeOf(expr.type, scope);
    }
    if (expr instanceof UniUnaryOp) {
      switch (expr.operator) {
        case '+':
        case '-':
        case '~': {
          const operand = this.arithmeticTypeOf(expr.expr, scope);
          return operand !== null && isArithmeticType(operand)
            ? promotedType(operand)
            : null;
        }
        case '!':
          return 'int';
        case 'sizeof':
          return 'unsigned long';
        case '()':
        case '++':
        case '--':
        case '++_':
        case '_++':
        case '--_':
        case '_--':
          return this.arithmeticTypeOf(expr.expr, scope);
        default: {
          const type = this.staticTypeOf(expr, scope);
          return type === null ? null : this.cTypeOf(type, scope);
        }
      }
    }
    if (expr instanceof UniBinOp) {
      const op = expr.operator;
      if (op === '[]' || op === '.' || op === '->') {
        const type = this.staticTypeOf(expr, scope);
        if (type === null) {
          return null;
        }
        // A bit-field narrower than `int` promotes to `int`, which holds
        // every value it can (6.3.1.1p2).
        const bits = this.bitFieldWidthOf(expr, scope);
        return bits !== null && bits < 32 ? 'int' : this.cTypeOf(type, scope);
      }
      const left = this.arithmeticTypeOf(expr.left, scope);
      if (expr.right === null || typeof expr.right === 'undefined') {
        // A postfix `++` or `--`, which the mapper writes without a right.
        return left;
      }
      if (ASSIGNMENT.test(op)) {
        return left;
      }
      const right = this.arithmeticTypeOf(expr.right, scope);
      if (op === ',') {
        return right;
      }
      if (/^(?:&&|\|\||<|>|<=|>=|==|!=)$/.test(op)) {
        return 'int';
      }
      if (op === '<<' || op === '>>') {
        return left !== null && isIntegerType(left) ? promotedType(left) : null;
      }
      return left !== null && right !== null ? commonType(left, right) : null;
    }
    if (expr instanceof UniTernaryOp) {
      const whenTrue = this.arithmeticTypeOf(expr.trueExpr, scope);
      const whenFalse = this.arithmeticTypeOf(expr.falseExpr, scope);
      if (whenTrue === null || whenFalse === null) {
        return null;
      }
      return whenTrue === whenFalse
        ? whenTrue
        : commonType(whenTrue, whenFalse);
    }
    if (
      expr instanceof UniMethodCall &&
      expr.receiver === null &&
      expr.methodName instanceof UniIdent
    ) {
      const dec = this.functionNamed(expr.methodName.name, scope);
      if (dec !== null) {
        return this.cTypeOf(dec.returnType, scope);
      }
      return LIBRARY_RETURN_TYPES[expr.methodName.name] ?? null;
    }
    return null;
  }

  /** What a name in scope was declared as, the way the reader wrote it. */
  private identifierTypeOf(name: string, scope: Scope): string | null {
    let declared: string;
    try {
      declared = scope.getType(name);
    } catch {
      return null;
    }
    if (declared === 'SYSTEM') {
      return this.constantTypeOf(name, scope);
    }
    if (declared === 'FUNCTION' || declared === 'CLASS') {
      return null;
    }
    // `long long` reaches the engine as `long`; the declaration remembers.
    let address: number | undefined;
    try {
      address = scope.getAddress(name);
    } catch {
      address = undefined;
    }
    const info =
      typeof address === 'undefined'
        ? undefined
        : this.declarationInfoByAddress.get(address);
    if (
      typeof info?.declaredType === 'string' &&
      !/[*[]/.test(declared) &&
      !/^_fp\d+/.test(declared)
    ) {
      return this.cTypeOf(info.declaredType, scope);
    }
    return this.cTypeOf(declared, scope);
  }

  /** The type of an object-like macro the library defines. */
  private constantTypeOf(name: string, scope: Scope): string | null {
    const constant = LIBRARY_CONSTANTS[name] ?? STDIO_CONSTANTS[name];
    if (typeof constant !== 'undefined') {
      switch (constant.type) {
        case 'unsigned':
          return 'unsigned int';
        case 'long long':
        case 'unsigned long long':
          return constant.type;
        case 'long':
          return Math.abs(constant.value) <= 2147483648 ? 'long' : 'long long';
        case 'double':
          return 'double';
        default:
          return 'int';
      }
    }
    let value: unknown;
    try {
      value = scope.get(name);
    } catch {
      return null;
    }
    if (value instanceof Int) {
      return 'int';
    }
    return typeof value === 'number' && Number.isInteger(value)
      ? 'int'
      : typeof value === 'number'
        ? 'double'
        : null;
  }

  /**
   * A type as the engine spells it (`unsignedint`, a typedef name, `_e0`),
   * canonically spelled with typedefs resolved: the spelling the conversion
   * rules take.
   */
  private cTypeOf(spelled: string, scope: Scope | null): string {
    let text = spelled
      .replace(
        /\b(?:const|volatile|restrict|static|register|extern|auto)\b/g,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();
    for (let depth = 0; depth < 8; depth += 1) {
      const declarator = text.search(/[*[(]/);
      const base = (declarator === -1 ? text : text.slice(0, declarator))
        .replace(/^\s*(?:struct|union)\s+/, '')
        .trim();
      const rest = declarator === -1 ? '' : text.slice(declarator);
      const resolved = typedefIn(scope ?? this.globalScope, base);
      if (resolved !== null && resolved !== base) {
        text = `${resolved}${rest}`;
        continue;
      }
      const library = LIBRARY_TYPEDEFS[base];
      if (typeof library !== 'undefined') {
        // Width as well as name: `size_t` is an `unsigned long` of four bytes.
        return canonicalType(`${library.underlying}${rest}`);
      }
      if (/^_e\d+$/.test(base) || /^enum\b/.test(base)) {
        return canonicalType(`int${rest}`);
      }
      return canonicalType(rest === '' ? base : `${base} ${rest}`);
    }
    return canonicalType(text);
  }

  /**
   * What a bit-field of `bits` bits holds after a value is stored in it: the
   * value modulo 2^bits, read back as unsigned or, for a signed type, in two's
   * complement. A plain `int` bit-field is signed, as gcc and clang make it.
   */
  private bitFieldValue(raw: number, base: string, bits: number): number {
    const type = this.cTypeOf(base, null);
    if (type === '_Bool') {
      return raw !== 0 ? 1 : 0;
    }
    if (!Number.isFinite(raw)) {
      return 0;
    }
    const whole = BigInt(Math.trunc(raw));
    return Number(
      integerTypeInfo(type)?.signed === false
        ? BigInt.asUintN(bits, whole)
        : BigInt.asIntN(bits, whole)
    );
  }

  /** A bit-field's width, or null for any other member or expression. */
  private bitFieldWidthOf(expr: unknown, scope: Scope): number | null {
    if (
      !(expr instanceof UniBinOp) ||
      (expr.operator !== '.' && expr.operator !== '->') ||
      !(expr.right instanceof UniIdent)
    ) {
      return null;
    }
    let record = this.staticTypeOf(expr.left, scope);
    if (record === null) {
      return null;
    }
    record = scope.getTypedef(record);
    if (expr.operator === '->') {
      record = elementTypeOf(record);
    }
    const name = record.replace(/^\s*(struct|union)\s+/, '').trim();
    const memberName = expr.right.name;
    const member = this.tableFor(name)
      ?.membersOf(name)
      ?.find((one) => one.name === memberName);
    return typeof member?.bits === 'number' ? member.bits : null;
  }

  /** Integer constants have the type their spelling and value give them. */
  protected execIntLiteral(expr: UniIntLiteral, scope: Scope): any {
    const spelling = literalSpelling(expr) ?? String(expr.value);
    const type = literalType(spelling, false, expr.value);
    if (type === null || !Number.isFinite(expr.value)) {
      return super.execIntLiteral(expr, scope);
    }
    const exact = exactLiteral(spelling);
    if (exact !== null && isInexact(exact, type)) {
      this.warnInexact(`the constant ${spelling}`, type);
    }
    return engineValue(valueAs(expr.value, type), type);
  }

  /**
   * A value converted to the type of the object it is stored in, or to the
   * type a cast names (6.3.1.2 to 6.3.1.4): `unsigned char c = 300` holds 44,
   * `unsigned u = -1` holds 4294967295, and `(double)5` is a double. Upstream
   * converted to `int` alone and left every other type holding whatever it
   * was handed, so `c + 1` read the 300 back.
   *
   * `long` used to be left as it was, because `long long` reached the engine
   * spelled `long`; it now has a spelling of its own (`ENGINE_LONG_LONG`), so
   * a `long` wraps at its four bytes and a `long long` at its eight.
   */
  protected _execCast(type: string, value: any): any {
    const raw =
      typeof value === 'boolean'
        ? Number(value)
        : typeof value === 'number' || value instanceof Number
          ? Number(value.valueOf())
          : null;
    if (raw === null || typeof type !== 'string') {
      return super._execCast(type, value);
    }
    const bitField = /^(.*?)\s*:\s*(\d+)$/.exec(type);
    if (bitField !== null) {
      return new Int(this.bitFieldValue(raw, bitField[1], Number(bitField[2])));
    }
    const target = this.cTypeOf(type, null);
    if (isFloatingType(target)) {
      return raw;
    }
    if (!isIntegerType(target)) {
      return super._execCast(type, value);
    }
    if (convertsInexactly(raw, target)) {
      this.warnInexact(`${valueText(raw, target)} as a ${target}`, target);
    }
    return engineValue(valueAs(raw, target), target);
  }

  /**
   * Dividing by zero. C leaves it undefined for integers, and the engine
   * computes in JavaScript numbers, where it quietly yields `Infinity` - a
   * value no C program can produce and the memory view cannot show. Both
   * operands come through here already evaluated, so this is the last point
   * where the program can be stopped on the statement that did it.
   *
   * The bitwise operators are here because unicoen's table has no case for
   * any of them: `x | 1` fell off the end of its switch, returned null, and
   * took the statement with it - `printf("%d", 6 | 1)` printed nothing at
   * all, and nothing was said about why. JavaScript's own bitwise operators
   * are defined on 32-bit integers, which is the width `basicSizeof` gives a
   * C `int` here, so they are the operation C asks for rather than an
   * approximation of it.
   *
   * A floating divisor is the exception: IEEE arithmetic, which C's floating
   * types follow, defines `1.0 / 0.0` as infinity and `0.0 / 0.0` as NaN,
   * which is how a course meets `INFINITY` and `NAN`. The engine marks every
   * integer it computes as an `Int` and keeps a double as a plain number, so
   * a zero that is not an `Int` is a floating zero, and dividing by it is
   * left to the arithmetic.
   */
  protected execBinOpImple(op: string, l: any, r: any): any {
    const operation = this.operations[this.operations.length - 1];
    if (
      typeof operation !== 'undefined' &&
      operation.op === op &&
      operation.types !== null
    ) {
      const typed = this.typedBinOp(op, l, r, operation.types);
      if (typeof typed !== 'undefined') {
        return typed;
      }
    }
    if (
      (op === '%' || (op === '/' && r instanceof Int)) &&
      Number(r?.valueOf?.() ?? r) === 0
    ) {
      this.refuse(
        'division-by-zero',
        op === '/' ? 'division by zero' : 'remainder of a division by zero'
      );
    }
    const bitwise = BITWISE[op];
    if (typeof bitwise !== 'undefined') {
      return bitwise(Number(l?.valueOf?.() ?? l), Number(r?.valueOf?.() ?? r));
    }
    return super.execBinOpImple(op, l, r);
  }

  protected execAssign(address: number, value: any, scope: Scope): any {
    // A pointer's values are recorded as addresses, which the mutation view
    // spells as the canvas does once the step is laid out.
    const cellType = scope.getTypedef(scope.typeOnMemory.get(address) ?? '');
    const pointer =
      cellType.trim().endsWith('*') || isFunctionPointerType(cellType);
    this.constructs.assigns(
      this.valueAt(address, scope),
      this.unwritten.has(address),
      pointer
    );
    this.noteWrite(address);
    const info = this.declarationInfoByAddress.get(address);
    const type = scope.getRawType(address);
    if (info !== undefined && this.constBindsObject(info, type)) {
      this.refuse(
        'read-only-assignment',
        'the assignment attempts to modify a const-qualified object'
      );
    }
    if (Array.isArray(value) && type.endsWith('*')) {
      // `s = "yo"` and `names[1] = "zed"`: the engine evaluates a string
      // literal to its bytes, and a pointer was given those bytes to hold.
      // C stores the literal's address.
      value = this.literalAddress(value as number[], scope.global);
    }
    const result =
      type.indexOf('*') === -1 && this.tableFor(type) !== null
        ? this.copyRecord(type, address, value, scope)
        : super.execAssign(address, value, scope);
    if (type.endsWith('*')) {
      const block = Number(result?.valueOf?.() ?? result);
      if (Number.isFinite(block) && scope.isMallocArea(block)) {
        this.layOutHeapRecords(
          scope.getTypedef(type.slice(0, -1).trim()),
          block,
          scope
        );
      }
    }
    this.constructs.assigned(this.valueAt(address, scope), pointer);
    return result;
  }

  /**
   * `<stdio.h>` is `library/stdio.ts` over `printf.ts`, `scanf.ts` and
   * `stream.ts`, replacing every one of upstream's registrations (and with
   * them every call into `agh.sprintf` and the `scanf` package). The host
   * lends the functions what is private to this class: the diagnostics, the
   * record of which objects are written, the stdin mailbox the console
   * answers through, and the program's file system.
   *
   * A program that names `stdin`, `stdout` or `stderr` sees it as what C
   * declares: an object of type `FILE *` among the globals, initialized to
   * the address of its stream. Every other program has the streams without
   * the three objects on its canvas, the way `errno` is only drawn for a
   * program that names it.
   */
  protected includeStdio(global: Scope): void {
    super.includeStdio(global);
    this.errorOutput.length = 0;
    this.inputEnded = false;
    const reported = new Set<string>();
    const host: StdioHost = {
      global,
      stdout: (text) => this.stdout(text),
      getStdout: () => this.getStdout(),
      stderr: (text) => this.writeError(text),
      refuse: (rule, message) => this.refuse(rule, message),
      report: ({ rule, severity, message }) => {
        const range = this.currentRange();
        // A loop that makes the same mistake every turn has made it once.
        const key = `${rule}:${range?.line}:${range?.column}:${message}`;
        if (!reported.has(key)) {
          reported.add(key);
          this.record(rule, severity, message, false, range);
        }
      },
      wrote: (address) => this.noteWrite(address),
      literalAddress: (text) =>
        this.writtenStrings().find((one) => one.text === text)?.address ?? null,
      setWaiting: (waiting) => {
        this.setIsWaitingForStdin(waiting);
      },
      takeInput: () => {
        const text = this.getStdin();
        const ended = this.inputEnded;
        this.clearStdin();
        this.inputEnded = false;
        return { text, ended };
      },
      files: () => this.fileSystem,
      library: this.libraryHost(global),
    };
    const stdio = installStdio(host);
    this.stdio = stdio;
    for (const name of STDIO_FUNCTIONS) {
      global.setTop(name, stdio.functions[name], 'FUNCTION');
    }
    for (const [name, constant] of Object.entries(STDIO_CONSTANTS)) {
      global.setSystemVariable('SYSTEM', name, new Int(constant.value));
    }
    for (const name of STANDARD_STREAMS) {
      if (
        this.namedStreams.indexOf(name) === -1 ||
        global.variableAddress.has(name)
      ) {
        continue;
      }
      global.setTop(name, stdio.standard[name], 'FILE*');
      this.declarationInfoByAddress.set(global.variableAddress.get(name)!, {
        storageClasses: [],
        qualifiers: [],
        baseQualifiers: [],
        pointerQualifiers: [],
        region: 'global',
        initialized: true,
        readOnly: false,
      });
    }
  }

  /** Output to `stderr`: the same transcript as `stdout`, with its span kept. */
  private writeError(text: string): void {
    const start = this.getStdout().length;
    this.stdout(text);
    const end = this.getStdout().length;
    const last = this.errorOutput[this.errorOutput.length - 1];
    if (typeof last !== 'undefined' && last.end === start) {
      last.end = end;
    } else if (start < end) {
      this.errorOutput.push({ start, end });
    }
  }

  /**
   * Tells the read the program is waiting on that the reader ended standard
   * input, as Ctrl+D does at a terminal. What `stdin(text)` delivers with it
   * is read first, without a newline after it.
   */
  endInput(): void {
    this.inputEnded = true;
  }

  /** The spans of the program's output it wrote to `stderr`, in order. */
  errorSpans(): OutputSpan[] {
    return this.errorOutput.map((span) => ({ ...span }));
  }

  /** The program's file system, kept here for `fopen`, `remove` and `rename`. */
  setFileList(filelist: Map<string, ArrayBuffer>): void {
    super.setFileList(filelist);
    this.fileSystem = filelist;
  }

  /**
   * What `malloc` hands back: memory the program has not written yet.
   *
   * The engine fills a fresh block with random words, and a random word on the
   * canvas reads as a value something put there - the wrong lesson twice over,
   * because the number means nothing and nothing tells it apart from a number
   * the program computed. A block carved out of memory nothing has held before
   * is blanked instead, to the same empty value a local declared without an
   * initializer holds, so the row says `uninitialized` until the program
   * writes something into it.
   *
   * Only memory nothing has held before is blanked. What is already written at
   * an address the allocator hands out again is the truth about that memory -
   * a reader who finds the last owner's value in a new block has learned what
   * `free` does and does not do - so it is left where it is.
   */
  protected includeStdlib(global: Scope): void {
    super.includeStdlib(global);
    const allocate = global.get('malloc');
    if (typeof allocate !== 'function') {
      return;
    }
    const requests = this.heapRequests;
    const records = this.recordBlocks;
    const calls = this.calls;
    // A `function` rather than an arrow, for the reason `includeStdio` gives.
    const wrapped = function (this: unknown, ...args: any[]) {
      const start = global.address.heapAddress;
      const requested = Number(args[0]);
      // What is written where the block is about to land, read before the
      // allocator writes over it. This engine's heap cursor only moves
      // forward, so it is empty for every block it carves; an allocator that
      // filled the hole a `free` left would find the last owner's values here.
      const held = new Map<number, any>();
      const span =
        (Number.isFinite(requested) ? Math.max(requested, 0) : 0) +
        Engine.structInfoSize;
      for (let address = start; address < start + span; address += 1) {
        if (global.objectOnMemory.has(address)) {
          held.set(address, global.objectOnMemory.get(address));
        }
      }
      const block = allocate.apply(this, args);
      if (typeof block !== 'number' || block === 0) {
        // Nothing was allocated: `malloc` answering with a null pointer is the
        // one case where there is no block to say anything about.
        return block;
      }
      for (
        let address = block;
        address < global.address.heapAddress;
        address += 1
      ) {
        const type = global.typeOnMemory.get(address);
        if (typeof type === 'undefined') {
          continue;
        }
        if (held.has(address)) {
          global.objectOnMemory.set(address, held.get(address));
          continue;
        }
        // The word a record's block opens with is the address of its members
        // rather than one of them, and blanking it would lose the block.
        if (address === block && global.isStructType(type)) {
          continue;
        }
        global.objectOnMemory.set(address, null);
      }
      // What a record pointer taking the block lays out (`layOutHeapRecords`):
      // `calloc` and `realloc` carve through here too.
      const caller = calls[calls.length - 1]?.methodName;
      requests.set(block, {
        bytes: Number.isFinite(requested) ? Math.max(requested, 0) : 0,
        zeroed: caller instanceof UniIdent && caller.name === 'calloc',
      });
      records.delete(block);
      return block;
    };
    global.setTop('malloc', wrapped, 'FUNCTION');
    // The stock `free` removes the block's size in cells, and a block of
    // records spans a descriptor word more per record than that.
    const release = global.get('free');
    const limitOf = (block: number): number => this.heapLimitOf(block, global);
    if (typeof release === 'function') {
      global.setTop(
        'free',
        function (this: unknown, ...args: any[]) {
          const result = release.apply(this, args);
          const block = Number(args[0]?.valueOf?.() ?? args[0]);
          if (records.has(block)) {
            records.delete(block);
            const end = limitOf(block);
            for (let address = block; address < end; address += 1) {
              global.objectOnMemory.delete(address);
              global.typeOnMemory.delete(address);
            }
          }
          return result;
        },
        'FUNCTION'
      );
    }
  }

  /**
   * Whether a record has a member `Scope.setStruct` cannot lay out: an array
   * (one entry per element, where `setStruct` writes one for the whole
   * member and steps past the rest), directly or in a nested record.
   */
  private needsOwnLayout(type: string, seen: Set<string> = new Set()): boolean {
    const table = this.tableFor(type);
    const members = table?.membersOf(type) ?? null;
    if (members === null || seen.has(type)) {
      return false;
    }
    seen.add(type);
    return members.some(
      (member) =>
        member.lengths.length > 0 ||
        (member.type.indexOf('*') === -1 &&
          this.tableFor(member.type) !== null &&
          this.needsOwnLayout(member.type, seen))
    );
  }

  /**
   * One record object, declared: its descriptor word where `setTop` would
   * have put it, and every member - every element of an array member - at
   * the offset the layout gives it. An initializer list fills members in
   * order and zero-fills the rest; another record is copied; no initializer
   * leaves the members unwritten, or zero in static storage.
   */
  private allocateRecord(
    name: string,
    type: string,
    initializer: unknown,
    staticStorage: boolean,
    scope: Scope
  ): number {
    const table = this.tableFor(type)!;
    const descriptor = scope.address.stackAddress;
    scope.variableAddress.set(name, descriptor);
    scope.variableTypes.set(name, type);
    const list = Array.isArray(initializer) ? initializer : null;
    this.writeRecord(
      type,
      descriptor,
      list,
      staticStorage || list !== null,
      scope,
      !staticStorage && list === null
    );
    scope.address.stackAddress =
      descriptor + Engine.structInfoSize + table.sizeOf(type);
    if (typeof initializer === 'number' || initializer instanceof Number) {
      this.copyRecord(type, descriptor, Number(initializer), scope);
    }
    return descriptor + Engine.structInfoSize;
  }

  /**
   * Where each element of an array member is, and what type its entry has.
   * Elements of a record type are their descriptors.
   */
  private elementsOf(
    member: Member,
    address: number
  ): { address: number; type: string; record: boolean }[] {
    const count = member.lengths.reduce((total, length) => total * length, 1);
    const record =
      member.type.indexOf('*') === -1 && this.tableFor(member.type) !== null;
    const stride = record
      ? Engine.structInfoSize + this.tableFor(member.type)!.sizeOf(member.type)
      : Engine.sizeof(member.type);
    return Array.from({ length: count }, (_, index) => ({
      address: address + index * stride,
      type: member.type.replace(/^\s*(struct|union)\s+/, ''),
      record,
    }));
  }

  /** Allocates each element with the same descriptor/member shape as a scalar. */
  private allocateRecordArray(
    name: string,
    type: string,
    suffix: string,
    initializers: any[],
    scope: Scope
  ): number {
    const table = this.tableFor(type)!;
    const stride = Engine.structInfoSize + table.sizeOf(type);
    const descriptors: number[] = [];
    let descriptor = scope.address.stackAddress;
    for (const initializer of initializers) {
      descriptors.push(descriptor);
      this.writeRecord(
        type,
        descriptor,
        initializer,
        initializer !== null,
        scope
      );
      descriptor += stride;
    }
    scope.address.stackAddress = descriptor;

    const handle = scope.address.codeAddress;
    const arrayType = type + suffix;
    scope.variableAddress.set(name, handle);
    scope.variableTypes.set(name, arrayType);
    scope.objectOnMemory.set(handle, descriptors[0]);
    scope.typeOnMemory.set(handle, arrayType);
    scope.address.codeAddress += Engine.sizeof(arrayType);
    const allocation = { type, descriptors, scope };
    // Scope stores the variable under `handle`, but ExecState replaces an
    // array variable's address with the first element address while snapshotting.
    this.recordArrays.set(handle, allocation);
    this.recordArrays.set(descriptors[0], allocation);
    return descriptors[0];
  }

  /**
   * Assigns one record to another the way C does: member by member, into the
   * storage the destination already owns.
   *
   * The inherited path copies each member's stored word. That is right for a
   * scalar and wrong for a member that is itself a record, because the word
   * held there is the address of that member's own block - copying it hands
   * both records the same nested object, and a later write through one shows
   * up in the other. Recursing gives a nested member the same treatment as the
   * whole record. A pointer member is still copied as the word it is, which is
   * what C means by a shallow copy.
   */
  private copyRecord(
    type: string,
    descriptor: number,
    source: any,
    scope: Scope
  ): any {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    const target = scope.getValue(descriptor);
    if (
      layout === null ||
      members === null ||
      typeof target !== 'number' ||
      typeof source !== 'number'
    ) {
      // Nothing to walk: leave the write to the inherited path rather than
      // computing member addresses from a value that is not one.
      return super.execAssign(descriptor, source, scope);
    }
    // A record with a const member is not assignable as a whole, so refuse
    // before the first member moves - half a copy is worse than none.
    const readOnly = this.readOnlyMemberOf(type, target, scope);
    if (readOnly !== null) {
      this.refuse(
        'read-only-assignment',
        `the assignment attempts to modify the const-qualified structure or union member ${readOnly}`
      );
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const destination = target + field[0];
      const origin = source + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (member.lengths.length > 0) {
        // An array member is copied element by element: assigning a record
        // is the one way C copies an array with `=`.
        const to = this.elementsOf(member, destination);
        this.elementsOf(member, origin).forEach((element, at) => {
          if (element.record) {
            this.copyRecord(
              element.type,
              to[at].address,
              scope.getValue(element.address),
              scope
            );
          } else if (scope.objectOnMemory.has(element.address)) {
            scope.objectOnMemory.set(
              to[at].address,
              scope.getValue(element.address)
            );
          }
        });
        continue;
      }
      if (nested !== null) {
        this.copyRecord(
          member.type,
          destination,
          scope.getValue(origin),
          scope
        );
        continue;
      }
      if (scope.objectOnMemory.has(origin)) {
        scope.objectOnMemory.set(destination, scope.getValue(origin));
      }
    }
    return target;
  }

  /**
   * The first const member the record holds, named as the program writes it,
   * or null if every member is assignable. Members are checked here rather
   * than in `execAssign` because a whole-record assignment never reaches it
   * for a member: the copy writes their addresses directly.
   */
  private readOnlyMemberOf(
    type: string,
    memberBase: number,
    scope: Scope
  ): string | null {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    if (layout === null || members === null) {
      return null;
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const address = memberBase + field[0];
      const info = this.declarationInfoByAddress.get(address);
      if (info !== undefined && this.constBindsObject(info, member.type)) {
        return member.name;
      }
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (nested === null) {
        continue;
      }
      const nestedBase = scope.getValue(address);
      if (typeof nestedBase !== 'number') {
        continue;
      }
      const found = this.readOnlyMemberOf(member.type, nestedBase, scope);
      if (found !== null) {
        return `${member.name}.${found}`;
      }
    }
    return null;
  }

  /** Writes one record and recursively materialises record-valued members. */
  /**
   * Writes one record and recursively materialises record-valued members.
   *
   * An array member gets one entry per element, as an array variable does:
   * `char name[8]` is eight `char`s, which is what the canvas draws and what
   * `strcpy(s.name, ...)` writes into. A member left without a value is
   * zero when `zeroFill` says so, unwritten (`null`) when `blank` does, and
   * the engine's indeterminate bits otherwise.
   */
  private writeRecord(
    type: string,
    descriptor: number,
    initializer: any,
    zeroFill: boolean,
    scope: Scope,
    blank: boolean = false
  ): void {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const members = table.membersOf(type)!;
    const values = Array.isArray(initializer) ? initializer : [];
    const memberBase = descriptor + Engine.structInfoSize;
    // Filed under the name the runtime registered the layout under, which
    // has no tag keyword: `struct Pair` is `Pair` to `Scope.get`.
    scope.typeOnMemory.set(
      descriptor,
      type.replace(/^\s*(struct|union)\s+/, '')
    );
    scope.objectOnMemory.set(descriptor, memberBase);
    const missing = (): unknown =>
      zeroFill ? 0 : blank ? null : this.randInt32();

    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const field = layout.get(member.name)!;
      const address = memberBase + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      const hasValue = index < values.length;
      if (table === this.unions && index !== 0) {
        continue;
      }
      if (member.lengths.length > 0) {
        const elements = this.elementsOf(member, address);
        const given = hasValue
          ? nested === null
            ? placedInitializer(values[index], member.lengths)
            : Array.isArray(values[index])
              ? values[index]
              : [values[index]]
          : [];
        elements.forEach((element, at) => {
          const value = given[at];
          if (element.record) {
            this.writeRecord(
              element.type,
              element.address,
              typeof value === 'undefined' ? [] : value,
              zeroFill || hasValue,
              scope,
              blank && !hasValue
            );
            return;
          }
          scope.typeOnMemory.set(element.address, element.type);
          scope.objectOnMemory.set(
            element.address,
            typeof value === 'undefined'
              ? hasValue
                ? 0
                : missing()
              : this._execCast(element.type, value)
          );
        });
        continue;
      }
      if (nested !== null) {
        this.writeRecord(
          member.type,
          address,
          hasValue ? values[index] : [],
          zeroFill || !hasValue,
          scope,
          blank && !hasValue
        );
      } else {
        scope.typeOnMemory.set(address, this.cellTypeOf(type, member, field));
        scope.objectOnMemory.set(
          address,
          hasValue
            ? this._execCast(
                this.cellTypeOf(type, member, field),
                values[index]
              )
            : missing()
        );
      }
    }
  }

  /** The type a member's entry is filed under (`runtimeLayout`'s spelling). */
  private cellTypeOf(
    _record: string,
    member: Member,
    field: [number, string, number]
  ): string {
    const base = field[1].replace(/^\s*(struct|union)\s+/, '');
    return typeof member.bits === 'number' ? `${base}:${member.bits}` : base;
  }

  /** Builds the member Variables that ExecState omits for record elements. */
  private recordVariable(
    type: string,
    name: string,
    descriptor: number,
    depth: number,
    scope: Scope
  ): Variable {
    const table = this.tableFor(type)!;
    const layout = table.layoutOf(type)!;
    const members = table.membersOf(type)!;
    const memberBase = scope.objectOnMemory.get(descriptor);
    const fields = members.map((member) => {
      const field = layout.get(member.name)!;
      const address = memberBase + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (member.lengths.length > 0) {
        return this.memberArrayVariable(member, address, depth, scope);
      }
      return nested === null
        ? new Variable(
            this.cellTypeOf(type, member, field),
            member.name,
            scope.objectOnMemory.get(address),
            address,
            depth
          )
        : this.recordVariable(member.type, member.name, address, depth, scope);
    });
    const variable = new Variable(type, name, null, descriptor, depth);
    (variable as any).value = fields;
    return variable;
  }

  /**
   * An array member as the canvas draws an array: a variable whose value is
   * its elements, each with its own address, rows of a two-dimensional one
   * nested as the engine nests a plain array's.
   */
  private memberArrayVariable(
    member: Member,
    address: number,
    depth: number,
    scope: Scope
  ): Variable {
    const elements = this.elementsOf(member, address);
    const elementType = member.type.replace(/^\s*(struct|union)\s+/, '');
    const build = (
      name: string,
      lengths: number[],
      first: number
    ): Variable => {
      const suffix = lengths.map((length) => `[${length}]`).join('');
      const row = lengths.slice(1).reduce((total, length) => total * length, 1);
      const items = Array.from({ length: lengths[0] }, (_, index) => {
        const itemName = `${name}[${index}]`;
        if (lengths.length > 1) {
          return build(itemName, lengths.slice(1), first + index * row);
        }
        const element = elements[first + index];
        return element.record
          ? this.recordVariable(
              element.type,
              itemName,
              element.address,
              depth,
              scope
            )
          : new Variable(
              element.type,
              itemName,
              scope.objectOnMemory.get(element.address),
              element.address,
              depth
            );
      });
      const variable = new Variable(
        `${elementType}${suffix}`,
        name,
        null,
        elements[first].address,
        depth
      );
      (variable as any).value = items;
      return variable;
    };
    return build(member.name, member.lengths, 0);
  }

  /**
   * Refuses what C refuses, where the user is looking.
   *
   * `Engine.execFunc` swallows every exception a statement throws, so a bare
   * throw ends the program with nothing to show for it: the output stops, the
   * canvas holds the last state, and nothing says which line the program died
   * on or why. Writing the reason to the console before throwing is what turns
   * that silence into a diagnostic. The throw still ends the run because the
   * detected operation would have undefined behavior, and the console keeps
   * everything written to it up to that point.
   *
   * What is thrown is an `Exit`, because that is the one exception
   * `execFunc` hands on from a called function: anything else is swallowed at
   * the function's boundary, and a refusal inside a helper used to let its
   * caller run on after the console had said the program stopped.
   */
  private refuse(rule: string, message: string): never {
    this.writeLine(
      `c-visualizer stopped the program${this.onLine()}: ${message}\n`
    );
    this.record(rule, 'error', message, true, this.currentRange());
    throw new RuntimeRefusal(message);
  }

  /** Output on a line of its own, after whatever the program printed. */
  private writeLine(text: string): void {
    const transcript = this.getStdout();
    const separator =
      transcript === '' || transcript.endsWith('\n') ? '' : '\n';
    this.stdout(`${separator}${text}`);
  }

  private onLine(): string {
    const line = this.currentLine();
    if (line === null) {
      return '';
    }
    // A program of several files runs as one; the reader counts lines in the
    // file they are looking at, and is told which one when it is not the
    // file the program starts in.
    const at = this.sourceLineOf(line);
    const entry = this.sourceLocator?.entry || at.file;
    return at.file === entry
      ? ` on line ${at.line}`
      : ` on line ${at.line} of ${at.file}`;
  }

  /**
   * Tells the engine which file each line of the source it is given came
   * from. `server.ts` composes several files into the one translation unit
   * unicoen.ts can execute, and only it knows where each one starts.
   */
  setSourceLocator(locator: SourceLocator | null): void {
    this.sourceLocator = locator;
  }

  /** A line of the executed source, in the file it was written in. */
  private sourceLineOf(line: number): SourceLine {
    const located =
      this.sourceLocator === null ? null : this.sourceLocator.locate(line);
    return located ?? { file: ASSERT_FILE, line };
  }

  /**
   * What C leaves undefined about a subscript: an index outside the array, and
   * a subscript through a null pointer.
   *
   * Only an object whose declared type says how long it is can be checked. A
   * pointer knows nothing about the block it addresses - `p[7]` on a
   * `malloc(4)` is exactly as legal to the compiler as `p[0]` - so what is
   * checked there is that it addresses something at all.
   */
  private checkSubscript(name: string, index: number, scope: Scope): void {
    let type = '';
    try {
      type = scope.getRawType(name);
    } catch {
      return;
    }
    if (typeof type !== 'string') {
      return;
    }
    if (type.indexOf('[') === -1) {
      if (
        type.indexOf('*') !== -1 &&
        Number(scope.getValue(scope.getAddress(name))) === 0
      ) {
        this.refuse(
          'null-dereference',
          `${name} has a null pointer value, so ${name}[${index}] does not designate an object`
        );
      }
      return;
    }
    const dimensions = scope.getArrayDims(type);
    const length = dimensions.length === 0 ? 0 : dimensions[0];
    if (length <= 0) {
      return;
    }
    if (index < 0 || length <= index) {
      this.refuse(
        'array-out-of-bounds',
        `index ${index} is outside the bounds of ${name}; valid ` +
          `indices for its first dimension are 0 through ${length - 1}`
      );
    }
  }

  /**
   * Whether the object at an address has been written since it was declared.
   * Nothing enters `unwritten` unless the source is certain about it, so the
   * answer is only ever given about a local declared with no initializer.
   */
  private noteWrite(address: number): void {
    this.unwritten.delete(address);
  }

  /**
   * The read of an object nothing has written. Reported once per object: a
   * loop reading it a thousand times is one mistake, not a thousand.
   */
  private checkRead(expr: UniIdent, scope: Scope): void {
    let address = -1;
    try {
      address = scope.getAddress(expr.name);
    } catch {
      return;
    }
    if (!this.unwritten.has(address) || this.readUnwritten.has(address)) {
      return;
    }
    this.readUnwritten.add(address);
    this.warn(
      'uninitialized-read',
      `${expr.name} is evaluated before a value is stored in it; its value ` +
        `is indeterminate, and using that value has undefined behavior`,
      rangeOfNode(expr)
    );
  }

  /** The scalar cells belonging to an uninitialized record object. */
  private noteUnwrittenRecord(type: string, address: number): void {
    const table = this.tableFor(type);
    const layout = table?.layoutOf(type) ?? null;
    const members = table?.membersOf(type) ?? null;
    if (layout === null || members === null) {
      return;
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const memberAddress = address + Engine.structInfoSize + field[0];
      if (member.lengths.length > 0) {
        for (const element of this.elementsOf(member, memberAddress)) {
          if (element.record) {
            this.noteUnwrittenRecord(element.type, element.address);
          } else {
            this.unwritten.add(element.address);
          }
        }
        continue;
      }
      this.unwritten.add(memberAddress);
      this.noteUnwrittenRecord(member.type, memberAddress);
    }
  }

  /** Whether every object in this declaration has static storage duration. */
  private hasStaticStorage(
    sourceInfo: ({
      storageClasses: StorageClass[];
    } | null)[],
    modifiers: string[],
    scope: Scope
  ): boolean {
    if (scope === scope.global) {
      return true;
    }
    const classes = sourceInfo
      .flatMap((info) => (info === null ? [] : info.storageClasses))
      .concat(
        modifiers.filter((item) => this.isStorageClass(item)) as StorageClass[]
      );
    return classes.some(
      (item) =>
        item === 'static' ||
        item === 'extern' ||
        item === '_Thread_local' ||
        item === 'thread_local'
    );
  }

  /** Replaces the stock engine's empty record members with static zeroes. */
  private zeroInitializeRecord(
    type: string,
    descriptor: number,
    scope: Scope
  ): void {
    const table = type.indexOf('*') === -1 ? this.tableFor(type) : null;
    const layout = table?.layoutOf(type) ?? null;
    const members = table?.membersOf(type) ?? null;
    const memberBase = scope.objectOnMemory.get(descriptor);
    if (layout === null || members === null || typeof memberBase !== 'number') {
      return;
    }
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const address = memberBase + field[0];
      const nested =
        member.type.indexOf('*') === -1 ? this.tableFor(member.type) : null;
      if (member.lengths.length > 0) {
        for (const element of this.elementsOf(member, address)) {
          if (element.record) {
            this.zeroInitializeRecord(element.type, element.address, scope);
          } else if (scope.objectOnMemory.has(element.address)) {
            scope.objectOnMemory.set(element.address, 0);
          }
        }
      } else if (nested === null) {
        if (scope.objectOnMemory.has(address)) {
          scope.objectOnMemory.set(address, 0);
        }
      } else {
        this.zeroInitializeRecord(member.type, address, scope);
      }
    }
  }

  /**
   * The local objects a declaration leaves empty. Each array element and
   * record member is tracked separately: writing `values[1]` initializes that
   * object, not its neighbours. Static storage is omitted because C fills it
   * with zero before the program starts.
   */
  private noteDeclaration(decVar: UniVariableDec, scope: Scope): void {
    if (
      scope === scope.global ||
      (Array.isArray(decVar.modifiers) &&
        (decVar.modifiers.indexOf('static') !== -1 ||
          decVar.modifiers.indexOf('extern') !== -1))
    ) {
      return;
    }
    for (const def of decVar.variables) {
      if (def.value !== null) {
        continue;
      }
      const name = def.name.replace(/^[*&]+/, '');
      const address = scope.variableAddress.get(name);
      if (typeof address === 'undefined') {
        continue;
      }
      if (def.typeSuffix === null || def.typeSuffix === '') {
        // A structure's own word is where its members are, not a value: the
        // members are tracked one by one, and naming the structure to reach
        // one (`pt.x = 1`) reads nothing indeterminate.
        const record =
          decVar.type.indexOf('*') === -1 &&
          !/^[*&]/.test(def.name) &&
          this.tableFor(decVar.type) !== null;
        if (!record) {
          this.unwritten.add(address);
        }
        this.noteUnwrittenRecord(decVar.type, address);
        continue;
      }
      const recordArray = this.recordArrays.get(address);
      if (typeof recordArray !== 'undefined') {
        for (const descriptor of recordArray.descriptors) {
          this.unwritten.add(descriptor);
          this.noteUnwrittenRecord(decVar.type, descriptor);
        }
        continue;
      }
      const first = scope.objectOnMemory.get(address);
      if (typeof first !== 'number') {
        continue;
      }
      const dimensions = scope.getArrayDims(def.typeSuffix);
      const count = dimensions.reduce((total, length) => total * length, 1);
      const elementSize = Engine.sizeof(
        decVar.type + '*'.repeat(this.pointerDepthOf(def))
      );
      for (let element = 0; element < count; element += 1) {
        this.unwritten.add(first + element * elementSize);
      }
    }
  }

  /**
   * The same, for what C leaves undefined but does not stop for. Reading an
   * object nobody has written is a fact about the program worth saying where
   * the reader is looking; ending the run over it would teach that C does
   * something it does not do.
   */
  private warn(
    rule: string,
    message: string,
    range: RuntimeDiagnostic | null = null
  ): void {
    this.record(rule, 'warning', message, false, range);
  }

  private record(
    rule: string,
    severity: 'warning' | 'error',
    message: string,
    fatal: boolean,
    range: RuntimeDiagnostic | null
  ): void {
    if (range === null) {
      return;
    }
    this.runtimeDiagnostics.push({ ...range, rule, severity, message, fatal });
  }

  /** Everything this run has been told off for. Cleared with the session. */
  public diagnostics(): RuntimeDiagnostic[] {
    return this.runtimeDiagnostics.slice();
  }

  /**
   * The statement the engine stopped at, as a range. The current expression is
   * the one that last produced a value, which by the time something is refused
   * is the statement before it; the next one is what it stopped to run.
   */
  private currentRange(): RuntimeDiagnostic | null {
    const expr =
      this.currentState.getNextExpr() ?? this.currentState.getCurrentExpr();
    return rangeOfNode(expr);
  }

  /**
   * The source line of the statement being executed, as the user typed it.
   *
   * The state's *current* expression is the one that last produced a value,
   * which by the time a statement is refused is the statement before it. The
   * next expression is the one the engine stopped at to run, and that is the
   * one to blame.
   */
  private currentLine(): number | null {
    const expr =
      this.currentState.getNextExpr() ?? this.currentState.getCurrentExpr();
    const range = typeof expr === 'undefined' ? null : expr.codeRange;
    if (range === null || typeof range === 'undefined') {
      return null;
    }
    return range.begin.y;
  }

  private tableFor(name: string): RecordTable | null {
    if (this.structs.has(name)) {
      return this.structs;
    }
    return this.unions.has(name) ? this.unions : null;
  }

  private isStorageClass(value: string): value is StorageClass {
    return (
      value === 'auto' ||
      value === 'register' ||
      value === 'static' ||
      value === 'extern' ||
      value === '_Thread_local' ||
      value === 'thread_local'
    );
  }

  private uniqueStorageClasses(values: StorageClass[]): StorageClass[] {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  private storageRegion(
    storageClasses: StorageClass[],
    scope: Scope
  ): StorageRegion {
    if (storageClasses.indexOf('register') !== -1) {
      return 'register';
    }
    if (
      storageClasses.indexOf('static') !== -1 ||
      storageClasses.indexOf('_Thread_local') !== -1 ||
      storageClasses.indexOf('thread_local') !== -1
    ) {
      return 'static';
    }
    if (scope.parent === null || storageClasses.indexOf('extern') !== -1) {
      return 'global';
    }
    return 'stack';
  }

  private constBindsObject(
    info: RuntimeDeclarationInfo,
    type: string
  ): boolean {
    if (type.indexOf('*') === -1) {
      return (info.baseQualifiers || info.qualifiers).indexOf('const') !== -1;
    }
    const levels = info.pointerQualifiers || [];
    return (
      levels.length > 0 && levels[levels.length - 1].indexOf('const') !== -1
    );
  }

  private registerRecordFields(
    type: string,
    descriptorAddress: number,
    parentInfo: RuntimeDeclarationInfo
  ): void {
    const table = this.tableFor(type);
    if (table === null || type.indexOf('*') !== -1) {
      return;
    }
    const layout = table.layoutOf(type);
    const members = table.membersOf(type);
    if (layout === null || members === null) {
      return;
    }
    const parentConst =
      (parentInfo.baseQualifiers || parentInfo.qualifiers).indexOf('const') !==
      -1;
    for (const member of members) {
      const field = layout.get(member.name);
      if (typeof field === 'undefined') {
        continue;
      }
      const address = descriptorAddress + Engine.structInfoSize + field[0];
      const baseQualifiers = parentConst
        ? this.uniqueQualifiers(member.baseQualifiers.concat(['const']))
        : member.baseQualifiers;
      const info: RuntimeDeclarationInfo = {
        storageClasses: parentInfo.storageClasses,
        qualifiers: this.uniqueQualifiers(
          baseQualifiers.concat(...member.pointerQualifiers)
        ),
        baseQualifiers,
        pointerQualifiers: member.pointerQualifiers,
        region: parentInfo.region,
        initialized: parentInfo.initialized,
        readOnly: parentInfo.readOnly || baseQualifiers.indexOf('const') !== -1,
      };
      if (member.lengths.length > 0) {
        for (const element of this.elementsOf(member, address)) {
          this.declarationInfoByAddress.set(element.address, info);
          if (element.record) {
            this.registerRecordFields(element.type, element.address, info);
          }
        }
        continue;
      }
      this.declarationInfoByAddress.set(address, info);
      this.registerRecordFields(member.type, address, info);
    }
  }

  private uniqueQualifiers<T>(values: T[]): T[] {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  /**
   * The runtime names records without their C tag keyword, and files a
   * bit-field under its width as well as its type (`unsigned:3`): the type an
   * entry is filed under is what an assignment converts to, which is how a
   * store into a bit-field wraps at its width (`_execCast`).
   */
  private runtimeLayout(
    layout: FieldOffset,
    members: Member[] | null = null
  ): FieldOffset {
    const normalized: FieldOffset = new Map();
    for (const [name, [offset, type, size]] of layout) {
      const bits = members?.find((member) => member.name === name)?.bits;
      const base = type.replace(/^\s*(struct|union)\s+/, '');
      normalized.set(name, [
        offset,
        typeof bits === 'number' ? `${base}:${bits}` : base,
        size,
      ]);
    }
    return normalized;
  }
}

/** The synthetic type `FunctionPointerTable` gives every declarator it maps. */
function isFunctionPointerType(type: string): boolean {
  return /^_fp\d+/.test(type);
}
