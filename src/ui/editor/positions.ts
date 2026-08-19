import { Text } from '@codemirror/state';

/**
 * The one place where the interpreter's coordinates and CodeMirror's meet.
 *
 * Three counting schemes exist in PLIVET and they disagree with each other:
 * the interpreter reports `codeRange.begin.y` counting lines from one,
 * breakpoints travel to the interpreter as rows counting from zero, and
 * CodeMirror numbers lines from one but addresses everything else by document
 * offset. Every conversion goes through the functions below so that the
 * off-by-one lives in one file that can be tested on its own.
 */

export interface SourceRange {
  from: number;
  to: number;
}

/** Clamps a one-based line number onto a document that may have shrunk. */
const lineAt = (doc: Text, line: number) =>
  doc.line(Math.min(Math.max(Math.trunc(line), 1), doc.lines));

/** The offset of a one-based line and a zero-based column. */
export const offsetAt = (doc: Text, line: number, column: number): number => {
  const found = lineAt(doc, line);
  return Math.min(found.from + Math.max(Math.trunc(column), 0), found.to);
};

/** The offset a zero-based row begins at, the form breakpoints are kept in. */
export const startOfRow = (doc: Text, row: number): number =>
  lineAt(doc, row + 1).from;

/** The zero-based row an offset falls on, the form breakpoints are sent in. */
export const rowAt = (doc: Text, offset: number): number =>
  doc.lineAt(Math.min(Math.max(offset, 0), doc.length)).number - 1;

/**
 * An interpreter code range as a pair of offsets. The end column is inclusive
 * in what the interpreter reports - it names the last character of the
 * expression - so one is added to make it the exclusive end CodeMirror wants.
 */
export const rangeOf = (
  doc: Text,
  beginLine: number,
  beginColumn: number,
  endLine: number,
  endColumn: number
): SourceRange => {
  const from = offsetAt(doc, beginLine, beginColumn);
  const to = Math.max(offsetAt(doc, endLine, endColumn + 1), from);
  return { from, to };
};

/** The whole of the line an offset falls on. */
export const rowRange = (doc: Text, row: number): SourceRange => {
  const found = lineAt(doc, row + 1);
  return { from: found.from, to: found.to };
};
