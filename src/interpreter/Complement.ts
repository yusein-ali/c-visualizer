import { UniBinOp } from 'unicoen.ts/dist/node/UniBinOp';
import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniUnaryOp } from 'unicoen.ts/dist/node/UniUnaryOp';
import { CodeLocation } from 'unicoen.ts/dist/node_helper/CodeLocation';
import { CodeRange } from 'unicoen.ts/dist/node_helper/CodeRange';

/**
 * `~a` as C reads it: the complement of `a`.
 *
 * The C++ grammar unicoen.ts parses with reads `~` written straight before a
 * name as part of the name - `~a` is how C++ names a destructor - so the tree
 * held an identifier called `~a`, which nothing declares: the run was refused
 * before it started. `~ a`, with a space, was already an operator.
 *
 * Every such identifier becomes the operator over the name. A postfix
 * operator binds tighter than `~`, so in `~f.bits`, `~v[1]` and `~g(x)` the
 * complement is of the member, the element and the call, not of `f`, `v` and
 * `g`, though the grammar put the `~` on the name at the far left.
 */
export function resolveComplements(tree: unknown): void {
  const seen = new Set<unknown>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) {
      return;
    }
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((item, index) => {
        node[index] = repaired(item);
        visit(node[index]);
      });
      return;
    }
    const fields = (node as { fields?: Map<string, unknown> }).fields;
    if (typeof fields === 'undefined') {
      return;
    }
    const record = node as Record<string, unknown>;
    for (const field of Array.from(fields.keys())) {
      if (field === 'comments' || field === 'codeRange') {
        continue;
      }
      record[field] = repaired(record[field]);
      visit(record[field]);
    }
  };
  visit(tree);
}

/** An identifier the grammar read with a `~` in front of its name. */
const isComplemented = (node: unknown): node is UniIdent =>
  node instanceof UniIdent &&
  typeof node.name === 'string' &&
  /^~\s*[A-Za-z_]\w*$/.test(node.name);

/** The expression a slot of the tree should hold: `node`, or its complement. */
function repaired(node: unknown): unknown {
  if (isComplemented(node)) {
    return complement(bare(node), node);
  }
  const base = complementedBase(node);
  if (base === null) {
    return node;
  }
  const ident = base.holder[base.field] as UniIdent;
  base.holder[base.field] = bare(ident);
  return complement(node as UniBinOp | UniMethodCall, ident);
}

/**
 * Where the complemented name is at the far left of a postfix expression:
 * the left of a member access, a subscript or a postfix `++` or `--`, or the
 * name of a call.
 */
function complementedBase(
  node: unknown
): { holder: Record<string, unknown>; field: string } | null {
  let current = node;
  for (;;) {
    if (
      current instanceof UniBinOp &&
      (current.operator === '.' ||
        current.operator === '->' ||
        current.operator === '[]' ||
        current.right === null ||
        typeof current.right === 'undefined')
    ) {
      if (isComplemented(current.left)) {
        return {
          holder: current as unknown as Record<string, unknown>,
          field: 'left',
        };
      }
      current = current.left;
      continue;
    }
    if (
      current instanceof UniMethodCall &&
      current.receiver === null &&
      isComplemented(current.methodName)
    ) {
      return {
        holder: current as unknown as Record<string, unknown>,
        field: 'methodName',
      };
    }
    return null;
  }
}

/** The name without its `~`, placed where the name itself is written. */
function bare(ident: UniIdent): UniIdent {
  const name = ident.name.replace(/^~\s*/, '');
  const plain = new UniIdent(name);
  const range = ident.codeRange;
  if (range !== null && typeof range !== 'undefined') {
    const skipped = ident.name.length - name.length;
    plain.codeRange = new CodeRange(
      new CodeLocation(range.begin.x + skipped, range.begin.y),
      range.end
    );
  }
  return plain;
}

/** `~operand`, spanning from the `~` to the end of the operand. */
function complement(
  operand: UniIdent | UniBinOp | UniMethodCall,
  tilde: UniIdent
): UniUnaryOp {
  const op = new UniUnaryOp('~', operand);
  const from = tilde.codeRange;
  const to = operand.codeRange;
  if (from !== null && typeof from !== 'undefined') {
    op.codeRange = new CodeRange(
      from.begin,
      to !== null && typeof to !== 'undefined' ? to.end : from.end
    );
  }
  return op;
}
