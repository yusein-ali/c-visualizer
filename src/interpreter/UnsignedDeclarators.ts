import { UniParam } from 'unicoen.ts/dist/node/UniParam';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniVariableDef } from 'unicoen.ts/dist/node/UniVariableDef';
import { CodeLocation } from 'unicoen.ts/dist/node_helper/CodeLocation';
import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';

/**
 * `unsigned n` as C reads it: an object `n` of type `unsigned int`.
 *
 * The C++ grammar unicoen.ts parses with lets a name written after `unsigned`
 * be read as a second type specifier - a class name, as C++ could have it -
 * and then the declaration has no declarator at all. The tree held a
 * parameter of type `unsignedn` with no name, or a declaration of nothing:
 * `unsigned f(unsigned g) { return g; }` was refused because `g` was not
 * declared, and `unsigned total;` declared no `total`. With an initializer
 * (`unsigned n = 5;`), a `*`, a `[`, a second declarator or a base type
 * word (`unsigned int n`) after it, the grammar already reads the name as
 * the declarator, and so does it for `signed n`.
 *
 * Each such declaration or parameter becomes one of type `unsigned` with
 * the name as its declarator, ranged where the name is written.
 */

/** The words `unsigned` can be followed by in a type C has. */
const TYPE_WORDS = new Set([
  'int',
  'char',
  'short',
  'long',
  'double',
  'float',
  '_Bool',
  'signed',
  'unsigned',
  'const',
  'volatile',
  'restrict',
]);

/** The tree's spelling of `unsigned NAME` read as two type specifiers. */
const JOINED = /^unsigned([A-Za-z_][A-Za-z0-9_]*)$/;

/** The name the grammar took as a type, or null for a type C has. */
const misreadName = (type: unknown): string | null => {
  if (typeof type !== 'string') {
    return null;
  }
  const match = JOINED.exec(type);
  if (match === null) {
    return null;
  }
  // `unsignedint`, `unsignedlonglong`: the mapper joins the words of a type
  // it did read. A name may start like one (`unsigned interval`), so only a
  // suffix made of nothing but type words is a type.
  let rest = match[1];
  for (let changed = true; changed && rest !== ''; ) {
    changed = false;
    for (const word of TYPE_WORDS) {
      if (rest.startsWith(word)) {
        rest = rest.slice(word.length);
        changed = true;
        break;
      }
    }
  }
  return rest === '' ? null : match[1];
};

/** Where `name` is written after `unsigned` inside a node's range. */
const nameRange = (
  lines: string[],
  range: CodeRange | null | undefined,
  name: string
): CodeRange | null => {
  if (
    range === null ||
    typeof range === 'undefined' ||
    !range.begin ||
    !range.end
  ) {
    return null;
  }
  const line = lines[range.begin.y - 1] ?? '';
  const end = range.end.y === range.begin.y ? range.end.x : line.length;
  const text = line.slice(range.begin.x, end);
  const match = new RegExp(`\\bunsigned\\s+(${name})\\b`).exec(text);
  if (match === null) {
    return null;
  }
  const column = range.begin.x + match.index + match[0].length - name.length;
  return new CodeRange(
    new CodeLocation(column, range.begin.y),
    new CodeLocation(column + name.length, range.begin.y)
  );
};

export function resolveUnsignedDeclarators(tree: unknown, code: string): void {
  const lines = code.split('\n');
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
      (node instanceof UniVariableDec || node instanceof UniParam) &&
      Array.isArray(node.variables) &&
      node.variables.length === 0
    ) {
      const name = misreadName(node.type);
      const range =
        name === null ? null : nameRange(lines, node.codeRange, name);
      // Only where the source says `unsigned` and the name: the range is
      // where the declarator is shown, and the check that it is one.
      if (name !== null && range !== null) {
        const def = new UniVariableDef(name, null as never, null as never);
        def.codeRange = range;
        node.type = 'unsigned';
        node.variables.push(def);
      }
      return;
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
