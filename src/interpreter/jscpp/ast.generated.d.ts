/**
 * Types for `ast.generated.js`, which PEG.js emits as plain JavaScript.
 *
 * Only the two members `JscppSyntax.ts` touches are declared. The parser also
 * returns an AST, and PLIVET deliberately ignores it: unicoen.ts owns the tree
 * that gets executed, and this grammar is consulted for a verdict alone.
 */

/** Where PEG.js stopped, one-based in both coordinates. */
export interface PegLocation {
  offset: number;
  line: number;
  column: number;
}

export interface PegExpectation {
  type: 'literal' | 'class' | 'any' | 'end' | 'other';
  value?: string;
  description: string;
}

/**
 * PEG.js's own error class. It is not an instance of any type we can import,
 * so `JscppSyntax` recognises it by the shape of these fields.
 */
export interface PegSyntaxError extends Error {
  location: { start: PegLocation; end: PegLocation };
  /** The text at the failure, or `null` at end of input. */
  found: string | null;
  expected: PegExpectation[];
}

/**
 * A parsed node. Only the fields the tree checks read are named; every node
 * also carries the `sLine`/`sColumn`/`eLine` triple the grammar's
 * `addPositionInfo` stamps on it.
 */
export interface PegNode {
  type?: string;
  sLine?: number;
  sColumn?: number;
  eLine?: number;
  /** Present on declarations, definitions and parameters. */
  DeclarationSpecifiers?: unknown[];
  [field: string]: unknown;
}

export declare function parse(input: string): PegNode;
