import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { lineAt, mask } from './scan';

/**
 * `int (*log)[3]` as a parameter, written as the array parameter it is the
 * same type as: `int log[][3]` (C11 6.7.6.3p7).
 *
 * unicoen.ts's parser has no rule for a parenthesized declarator that is not
 * a function's, and a program with one lost every function it defined. In a
 * parameter list the two spellings declare one type, a pointer to an array,
 * and the engine binds the second as that (`adjustedParameters`). The new
 * spelling is padded to the width of the old, so nothing else on the line
 * moves.
 *
 * Only a parameter is rewritten: one followed by `,` or `)`. A pointer to an
 * array declared as an object, `int (*p)[3] = log;`, has no array spelling.
 */
export function arrayPointerParameters(code: string): string {
  const masked = mask(code);
  const pattern =
    /([A-Za-z0-9_]\s*)\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*((?:\[[^\]\n]*\]\s*)+)(?=[,)])/g;
  let text = code;
  let found = pattern.exec(masked);
  while (found !== null) {
    const start = found.index + found[1].length;
    const end = found.index + found[0].length;
    const dimensions = found[3].replace(/\s+/g, '');
    const spelled = `${found[2]}[]${dimensions}`;
    text =
      text.slice(0, start) + spelled.padEnd(end - start, ' ') + text.slice(end);
    found = pattern.exec(masked);
  }
  return text;
}

/** A pointer to an array declared as an object, by its line and name. */
export interface ArrayPointerObject {
  line: number;
  name: string;
}

/**
 * `int (*row)[3] = malloc(2 * sizeof *row);` - a pointer to an array
 * declared as an object - written as `int  *row [3]`, which the parser reads,
 * with each such declarator listed so `resolveArrayPointerObjects` can give
 * the declaration back its type once the tree is built. The parentheses
 * become spaces, so nothing on the line moves. The declaration was otherwise
 * lost to the parser, and every later use of the name was refused as
 * undeclared.
 */
export function arrayPointerObjects(code: string): {
  code: string;
  objects: ArrayPointerObject[];
} {
  const masked = mask(code);
  const pattern =
    /([A-Za-z0-9_]\s*)\(\s*\*\s*([A-Za-z_]\w*)\s*\)\s*((?:\[[^\]\n]*\]\s*)+)(?=[=;,])/g;
  let text = code;
  const objects: ArrayPointerObject[] = [];
  let found = pattern.exec(masked);
  while (found !== null) {
    const open = found.index + found[1].length;
    const close = masked.indexOf(')', open);
    text =
      text.slice(0, open) +
      ' ' +
      text.slice(open + 1, close) +
      ' ' +
      text.slice(close + 1);
    objects.push({ line: lineAt(code, open), name: found[2] });
    found = pattern.exec(masked);
  }
  return { code: text, objects };
}

/**
 * The declarations `arrayPointerObjects` rewrote, given their type back: the
 * parser read `int *row[3]`, an array of pointers; the declaration is of a
 * pointer to `int[3]`, which the engine spells `int[3]*`, as it does a
 * parameter `int log[][3]`.
 */
export function resolveArrayPointerObjects(
  tree: unknown,
  objects: readonly ArrayPointerObject[]
): void {
  if (objects.length === 0) {
    return;
  }
  const wanted = new Set(objects.map(({ line, name }) => `${line}:${name}`));
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (
      node instanceof UniVariableDec &&
      node.variables.length === 1 &&
      typeof node.type === 'string'
    ) {
      const def = node.variables[0];
      const line = def.codeRange?.begin?.y;
      const name = String(def.name ?? '').replace(/^\*+/, '');
      if (
        typeof line === 'number' &&
        wanted.has(`${line}:${name}`) &&
        String(def.name).startsWith('*') &&
        typeof def.typeSuffix === 'string' &&
        def.typeSuffix.startsWith('[')
      ) {
        node.type = `${node.type}${def.typeSuffix.replace(/\s+/g, '')}`;
        def.typeSuffix = null as never;
        def.name = `*${name}`;
      }
    }
    const fields = (node as { fields?: Map<string, unknown> }).fields;
    if (typeof fields === 'undefined') {
      return;
    }
    for (const field of Array.from(fields.keys())) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit((node as Record<string, unknown>)[field]);
      }
    }
  };
  visit(tree);
}
