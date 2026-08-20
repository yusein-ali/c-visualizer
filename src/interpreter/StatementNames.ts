import { UniIdent } from 'unicoen.ts/dist/node/UniIdent';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';

/**
 * The names a statement mentions, in the order it mentions them.
 *
 * This is what the editor prints at the end of the line it is stopped on: not
 * the whole frame, which is what the canvas beside it is for, but the handful
 * of objects the statement about to run actually reads or assigns. A frame
 * rendered per line is noise; `i` and `sum` against `sum += a[i];` is the step
 * the reader would otherwise take in their head.
 *
 * The walk is generic - `UniNode.fields` names each node's children - so it
 * does not have to know the shape of the forty-odd node classes. A name that
 * belongs to no object in scope drops out later, when the values are looked
 * up, which is what keeps `printf` and `main` out of the list without this
 * file having to know what a function is. The callee of a call is skipped all
 * the same: a function pointer *is* an object in scope, and naming it beside
 * the call would report the address of the thing being called rather than
 * anything the statement computes with.
 */
export function statementNames(node: unknown): string[] {
  const names: string[] = [];
  const visit = (value: any): void => {
    if (value === null || typeof value !== 'object') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value.fields === 'undefined') {
      return;
    }
    if (value instanceof UniIdent) {
      names.push(value.name);
      return;
    }
    if (value instanceof UniVariableDec) {
      // The declarator introduces the name; only its initializer is a node
      // that would be walked into, so the name is taken from the field.
      for (const variable of value.variables) {
        if (typeof variable.name === 'string') {
          names.push(variable.name);
        }
        visit(variable.value);
      }
      return;
    }
    for (const field of Array.from(value.fields.keys()) as string[]) {
      if (field === 'comments' || field === 'codeRange') {
        continue;
      }
      if (value instanceof UniMethodCall && field === 'methodName') {
        continue;
      }
      visit(value[field]);
    }
  };
  visit(node);
  return names;
}
