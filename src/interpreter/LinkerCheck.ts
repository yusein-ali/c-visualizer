import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniParam } from 'unicoen.ts/dist/node/UniParam';
import { LintDiagnostic, LintRange } from './TeachingLint';

/**
 * The checks a linker would make, on the one translation unit there is.
 *
 * The compiler's own complaints are `TeachingLint`; these are the ones that
 * come afterwards, when the object files are put together, and they are the
 * ones a beginner meets last and understands least: the error arrives from a
 * program they have never heard of, names a symbol rather than a line, and
 * says nothing about where to look. Said at the second definition, or at the
 * call with nothing behind it, they are ordinary mistakes with ordinary
 * fixes.
 *
 * Three of them, and each is reported only where a linker would certainly
 * fail. What is deliberately not here is the call to a name this file never
 * declares: that is what a library function looks like from the tree, and a
 * rule that flagged `printf` because it cannot see `stdio.h` would teach a
 * reader to distrust the linter.
 */

/** A name defined at file scope, and where. */
interface Definition {
  name: string;
  line: number;
  range: LintRange;
}

const rangeOf = (node: any): LintRange | null => {
  const range = node === null ? null : node.codeRange;
  if (!range || !range.begin || !range.end) {
    return null;
  }
  return {
    line: range.begin.y,
    column: range.begin.x,
    endLine: range.end.y,
    endColumn: range.end.x,
  };
};

/** A function declaration with a body defines the function; a prototype does not. */
const hasBody = (node: any): boolean =>
  node.block !== null && typeof node.block !== 'undefined';

/** The declarator's stars belong to the name the parser reports: `*p`. */
const withoutStars = (name: string): string =>
  String(name ?? '').replace(/^\**/, '');

/** The name a call goes through, where it goes through a plain identifier. */
const calleeName = (call: any): string => {
  const named = call.methodName;
  if (named instanceof UniIdent && typeof named.name === 'string') {
    return named.name;
  }
  return '';
};

interface Scan {
  /** Functions with a body, by name, in the order they were defined. */
  definitions: Definition[];
  /** Functions declared without a body: the promises a linker has to keep. */
  prototypes: Map<string, Definition>;
  /** Objects with an initializer at file scope, in order. */
  objects: Definition[];
  /** Every call through a plain name, with where it is written. */
  calls: { name: string; range: LintRange }[];
}

/**
 * One walk over the tree. A linker check is not a walk with scope like the
 * teaching rules are - it is a question about the file as a whole - so the
 * facts are gathered first and judged afterwards.
 */
function scan(root: UniNode): Scan {
  const found: Scan = {
    definitions: [],
    prototypes: new Map(),
    objects: [],
    calls: [],
  };
  const visit = (node: any, depth: number): void => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, depth));
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    const isFunction = node instanceof UniFunctionDec;
    if (isFunction && typeof node.name === 'string') {
      const range = rangeOf(node);
      if (range !== null) {
        const entry = { name: node.name, line: range.line, range };
        if (hasBody(node)) {
          found.definitions.push(entry);
        } else if (!found.prototypes.has(node.name)) {
          found.prototypes.set(node.name, entry);
        }
      }
    }
    // File scope is depth zero. Only an initializer makes a definition strong
    // enough to conflict here: `int count; int count;` is two compatible
    // tentative definitions in C, and `extern int count;` is only a
    // declaration. An `extern` with an initializer is a definition and is
    // deliberately included.
    if (
      node instanceof UniVariableDec &&
      !(node instanceof UniParam) &&
      depth === 0
    ) {
      for (const variable of (node.variables ?? []) as any[]) {
        const range = rangeOf(variable) ?? rangeOf(node);
        const name = withoutStars(variable.name);
        if (
          range !== null &&
          name !== '' &&
          variable.value !== null &&
          typeof variable.value !== 'undefined'
        ) {
          found.objects.push({ name, line: range.line, range });
        }
      }
    }
    if (node instanceof UniMethodCall) {
      const name = calleeName(node);
      const range = rangeOf(node);
      if (name !== '' && range !== null) {
        found.calls.push({ name, range });
      }
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field], isFunction ? depth + 1 : depth);
      }
    }
  };
  visit(root, 0);
  return found;
}

/** The second and every later definition of one name. */
const duplicates = (
  definitions: Definition[],
  rule: string,
  kind: string
): LintDiagnostic[] => {
  const first = new Map<string, Definition>();
  const said: LintDiagnostic[] = [];
  for (const definition of definitions) {
    const earlier = first.get(definition.name);
    if (typeof earlier === 'undefined') {
      first.set(definition.name, definition);
      continue;
    }
    said.push({
      rule,
      severity: 'error',
      message:
        `${kind} \`${definition.name}\` is defined twice; the first ` +
        `definition is on line ${earlier.line}. A linker takes one ` +
        'definition of a name and refuses a program that offers two.',
      ...definition.range,
    });
  }
  return said;
};

/**
 * What the linker would refuse, over one program. Every position comes from
 * the tree, so unlike `teachingDiagnostics` this needs no copy of the source:
 * nothing here offers a fix, because none of the three has one edit that is
 * certainly the right one.
 */
export function linkerDiagnostics(root: UniNode): LintDiagnostic[] {
  const found = scan(root);
  const diagnostics: LintDiagnostic[] = [
    ...duplicates(found.definitions, 'multipleDefinition', 'The function'),
    ...duplicates(found.objects, 'multipleDefinition', 'The object'),
  ];

  const defined = new Set(found.definitions.map((one) => one.name));
  // A prototype is a promise that a definition exists somewhere. In one
  // translation unit with no libraries to link against, the only somewhere is
  // this file - so a promise nothing keeps is the classic undefined
  // reference, and it is reported at the call rather than at the prototype,
  // which is where the linker's own message would have sent the reader.
  const said = new Set<string>();
  for (const call of found.calls) {
    if (
      defined.has(call.name) ||
      !found.prototypes.has(call.name) ||
      said.has(call.name)
    ) {
      continue;
    }
    said.add(call.name);
    const prototype = found.prototypes.get(call.name) as Definition;
    diagnostics.push({
      rule: 'undefinedReference',
      severity: 'error',
      message:
        `\`${call.name}\` is declared on line ${prototype.line} and called ` +
        'here, but this program never defines it. A declaration says what a ' +
        'function looks like; a definition is the body the linker has to find.',
      ...call.range,
    });
  }

  // A program is what a linker makes out of object files, and it needs
  // somewhere to start. Said only where the file defines something, so that
  // an empty editor is not an error the moment it is opened.
  if (!defined.has('main')) {
    const first =
      found.prototypes.get('main') ||
      found.definitions[0] ||
      found.objects[0] ||
      found.prototypes.values().next().value;
    if (typeof first === 'undefined') {
      return diagnostics.sort(
        (left, right) => left.line - right.line || left.column - right.column
      );
    }
    diagnostics.push({
      rule: 'noEntryPoint',
      severity: 'error',
      message:
        'This program defines no `main`. Execution begins there, so a linker ' +
        'has nowhere to start and c-visualizer has nothing to run.',
      ...first.range,
      endLine: first.range.line,
      endColumn: first.range.column + 1,
    });
  }

  return diagnostics.sort(
    (left, right) => left.line - right.line || left.column - right.column
  );
}
