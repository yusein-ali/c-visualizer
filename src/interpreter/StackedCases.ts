import { UniExpr } from 'unicoen.ts/dist/node/UniExpr';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniSwitchUnit } from 'unicoen.ts/dist/node/UniSwitchUnit';

/**
 * `case 'q': case 'Q':` as C reads it: two labels on one statement.
 *
 * unicoen.ts's mapper reads a label written straight after another as part
 * of the first label's statements: an empty expression where the keyword
 * was, then the second label's constant as if it were a statement, then the
 * statements both labels share. Executing the empty expression stopped the
 * program ("could not be executed") whenever the first label matched, and
 * the second label matched nothing, so `case 3` ran `default`.
 *
 * Each such pair becomes a label of its own, holding the statements that
 * follow it; the first label's list is left empty, so a match there falls
 * through to them, as C has it. The source decides: the constant has to
 * stand right after the word `case`.
 */

/** An expression node the mapper produced from nothing it could read. */
const isEmptyExpression = (node: unknown): boolean =>
  node !== null &&
  typeof node === 'object' &&
  (node as object).constructor === UniExpr &&
  !(node as { codeRange?: unknown }).codeRange;

export function resolveStackedCases(tree: unknown, code: string): void {
  const lines = code.split('\n');
  /** Whether the source has the word `case` right before a node. */
  const labelled = (node: unknown): boolean => {
    const range = (node as { codeRange?: { begin?: { x: number; y: number } } })
      ?.codeRange;
    if (!range || !range.begin) {
      return false;
    }
    let before = (lines[range.begin.y - 1] ?? '').slice(0, range.begin.x);
    for (let line = range.begin.y - 2; before.trim() === '' && line >= 0; ) {
      before = (lines[line] ?? '') + '\n' + before;
      line -= 1;
    }
    return /(^|[^A-Za-z0-9_])case\s*$/.test(before);
  };
  const split = (unit: UniSwitchUnit): UniSwitchUnit[] => {
    const statements = Array.isArray(unit.statement) ? unit.statement : [];
    const units: UniSwitchUnit[] = [unit];
    let current = unit;
    current.statement = [];
    for (let i = 0; i < statements.length; i += 1) {
      const next = statements[i + 1];
      if (
        isEmptyExpression(statements[i]) &&
        typeof next !== 'undefined' &&
        labelled(next)
      ) {
        current = new UniSwitchUnit('case', next, []);
        current.codeRange = next.codeRange;
        units.push(current);
        i += 1;
        continue;
      }
      current.statement.push(statements[i]);
    }
    return units;
  };
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
    if (node instanceof UniSwitch && Array.isArray(node.cases)) {
      node.cases = node.cases.flatMap(split);
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
