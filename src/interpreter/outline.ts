import { UniNode } from 'unicoen.ts/dist/node/UniNode';
import { UniBreak } from 'unicoen.ts/dist/node/UniBreak';
import { UniCast } from 'unicoen.ts/dist/node/UniCast';
import { UniContinue } from 'unicoen.ts/dist/node/UniContinue';
import { UniDoWhile } from 'unicoen.ts/dist/node/UniDoWhile';
import { UniEnhancedFor } from 'unicoen.ts/dist/node/UniEnhancedFor';
import { UniFor } from 'unicoen.ts/dist/node/UniFor';
import { UniFunctionDec } from 'unicoen.ts/dist/node/UniFunctionDec';
import { UniIf } from 'unicoen.ts/dist/node/UniIf';
import { UniMethodCall } from 'unicoen.ts/dist/node/UniMethodCall';
import { UniReturn } from 'unicoen.ts/dist/node/UniReturn';
import { UniSwitch } from 'unicoen.ts/dist/node/UniSwitch';
import { UniTernaryOp } from 'unicoen.ts/dist/node/UniTernaryOp';
import { UniVariableDec } from 'unicoen.ts/dist/node/UniVariableDec';
import { UniWhile } from 'unicoen.ts/dist/node/UniWhile';
import { Construct } from './Construct';

/**
 * Walks a parsed program and lists the constructs worth explaining on hover.
 *
 * Only statement-level nodes and calls are listed. Every literal and every
 * operand carries a code range too, and listing those buries the useful marks
 * in noise - the interesting question for a reader is "what is this line
 * doing", not "this is an int literal".
 *
 * Traversal is generic: `UniNode.fields` names each node's children, so this
 * does not have to know the shape of the forty-odd node classes.
 */
/**
 * Matched with instanceof rather than by class name: the production build
 * minifies, and `constructor.name` becomes a mangled letter there - a bug that
 * cannot show up in Node, where the names survive.
 *
 * Subclasses come first: UniDoWhile extends UniWhile, so testing UniWhile
 * first would label every do-while a while.
 */
const KINDS: Array<[Function, string]> = [
  [UniDoWhile, 'doWhile'],
  [UniWhile, 'while'],
  [UniEnhancedFor, 'for'],
  [UniFor, 'for'],
  [UniIf, 'if'],
  [UniSwitch, 'switch'],
  [UniReturn, 'return'],
  [UniBreak, 'break'],
  [UniContinue, 'continue'],
  [UniVariableDec, 'variableDec'],
  [UniFunctionDec, 'functionDec'],
  [UniMethodCall, 'call'],
  [UniTernaryOp, 'ternary'],
  [UniCast, 'cast'],
];

const kindOf = (node: object): string | null => {
  for (const [type, kind] of KINDS) {
    if (node instanceof (type as any)) {
      return kind;
    }
  }
  return null;
};

const nameOf = (node: any): string =>
  node !== null && typeof node === 'object' && typeof node.name === 'string'
    ? node.name
    : '';

/** What makes the kind concrete: the declared type, the called function. */
function detailOf(node: any): string {
  if (node instanceof UniVariableDec || node instanceof UniCast) {
    return typeof node.type === 'string' ? node.type : '';
  }
  if (node instanceof UniFunctionDec) {
    return `${
      typeof node.returnType === 'string' ? node.returnType + ' ' : ''
    }${nameOf(node)}`.trim();
  }
  if (node instanceof UniMethodCall) {
    return nameOf(node.methodName);
  }
  return '';
}

export function outline(root: UniNode): Construct[] {
  const constructs: Construct[] = [];
  const visit = (node: any) => {
    if (node === null || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node.fields === 'undefined') {
      return;
    }
    const kind = kindOf(node);
    const range = node.codeRange;
    if (kind !== null && range && range.begin && range.end) {
      constructs.push({
        kind,
        detail: detailOf(node),
        line: range.begin.y,
        column: range.begin.x,
        endLine: range.end.y,
        endColumn: range.end.x + 1,
      });
    }
    for (const field of Array.from(node.fields.keys()) as string[]) {
      if (field !== 'comments' && field !== 'codeRange') {
        visit(node[field]);
      }
    }
  };
  visit(root);
  return constructs;
}
