import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniParam } from 'unicoen.ts/dist/node/UniParam';
import { LintDiagnostic, LintRange } from './TeachingLint';

/**
 * Linkage and program-structure checks over the visualizer's combined source.
 *
 * A native implementation diagnoses some of these while translating a
 * translation unit and others while linking object files. c-visualizer has
 * neither boundary: it combines its source files for one interpreter, so the
 * useful and accurate distinction here is between declarations and
 * definitions, not between compiler and linker phases.
 *
 * Three of them, and each is reported only where execution cannot be formed
 * from the supplied source. What is deliberately not here is a call to a name
 * this source never
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

/** A function declaration with a body is a definition; a prototype is not. */
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
  /** Functions declared without a body. */
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
        `${kind} \`${definition.name}\` is defined more than once; the first ` +
        `definition is on line ${earlier.line}. Only one definition with ` +
        'that identifier is permitted here.',
      ...definition.range,
    });
  }
  return said;
};

/**
 * What prevents one executable program from being formed. Every position comes from
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
  // The interpreter needs a definition before it can execute a declared
  // function. Report the missing definition at the call that requires it.
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
        'here, but the supplied source contains no definition. A function ' +
        'declaration specifies its type; a function definition supplies the body to execute.',
      ...call.range,
    });
  }

  // c-visualizer models a hosted C implementation, where program startup calls
  // `main`. Said only where the source defines something, so an empty editor is
  // not an error the moment it is opened.
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
        'This program defines no `main`. In the hosted C environment modeled ' +
        'by c-visualizer, program startup calls `main`, so there is nothing to run.',
      ...first.range,
      endLine: first.range.line,
      endColumn: first.range.column + 1,
    });
  }

  return diagnostics.sort(
    (left, right) => left.line - right.line || left.column - right.column
  );
}
