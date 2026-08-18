import { Construct, constructAt } from '../src/interpreter/Construct';

const at = (
  kind: string,
  line: number,
  column: number,
  endLine: number,
  endColumn: number
): Construct => ({ kind, detail: '', line, column, endLine, endColumn });

/*
 *  1  int main(){          <- functionDec opens
 *  2    int i = 0;         <- variableDec, one line
 *  3    do {               <- doWhile opens
 *  4      i++;             <- inside the body, no construct of its own
 *  5    } while (i < 3);   <- doWhile closes
 *  6  }                    <- functionDec closes
 */
const program: Construct[] = [
  at('functionDec', 1, 0, 6, 1),
  at('variableDec', 2, 2, 2, 12),
  at('doWhile', 3, 2, 5, 18),
];

it('describes a construct on the line it opens on', () => {
  expect(constructAt(program, 3, 2)!.kind).toBe('doWhile');
});

it('describes a construct on the line it closes on', () => {
  expect(constructAt(program, 5, 4)!.kind).toBe('doWhile');
});

it('says nothing in the middle of a body', () => {
  // The reader is asking about this line, not the loop around it.
  expect(constructAt(program, 4, 6)).toBeNull();
});

it('prefers the innermost construct when several match a line', () => {
  const nested = program.concat([at('if', 3, 8, 3, 20)]);
  expect(constructAt(nested, 3, 10)!.kind).toBe('if');
});

it('requires the column to be inside a single-line construct', () => {
  expect(constructAt(program, 2, 2)!.kind).toBe('variableDec');
  expect(constructAt(program, 2, 0)).toBeNull();
  expect(constructAt(program, 2, 30)).toBeNull();
});

it('returns null when nothing is recorded', () => {
  expect(constructAt([], 1, 0)).toBeNull();
});
