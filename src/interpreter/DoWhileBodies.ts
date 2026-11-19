import {
  IDENT_START,
  identifierEnd,
  isWholeIdentifier,
  mask,
  matchBrace,
  matchParen,
  skipSpace,
} from './scan';

/**
 * A do-while whose body is one statement without braces, given its braces:
 * `do k++; while (k < 3);` is `do{k++;}while (k < 3);`, which C reads the
 * same way (C11 6.8.5).
 *
 * unicoen.ts's grammar has a do-while only around a compound statement, and
 * read the first spelling by error recovery: the rest of the function became
 * the body, the condition was lost, and the loop ran its body once and then
 * never ended.
 *
 * A brace takes the place of a blank beside the body where there is one, so
 * nothing on the line moves; where the body starts or ends a line, it goes
 * at the end of that line, after which nothing else does. Only a body packed
 * against `do` or `while` on both sides (`do(k++);while`) moves the rest of
 * its line by a column.
 *
 * The syntax check reads the source before this pass: a body C does not
 * allow - a declaration - is not made one it does.
 */
export function bracedDoBodies(code: string): string {
  const masked = mask(code);
  const edits: { at: number; remove: number; text: string }[] = [];
  const keyword = /\bdo\b/g;
  let found = keyword.exec(masked);
  while (found !== null) {
    const after = found.index + 2;
    const body = skipSpace(masked, after);
    const end =
      masked[body] === '{' || !isWholeIdentifier(masked, found.index, 2)
        ? -1
        : statementEnd(masked, body);
    const condition = end === -1 ? -1 : skipSpace(masked, end);
    if (condition !== -1 && wordAt(masked, condition) === 'while') {
      edits.push(brace(masked, after, body, '{'));
      edits.push(brace(masked, end, condition, '}'));
    }
    found = keyword.exec(masked);
  }
  // From the last edit back, so an inserted brace does not move the places
  // the ones before it go.
  let text = code;
  for (const { at, remove, text: brace } of edits.sort((a, b) => b.at - a.at)) {
    text = text.slice(0, at) + brace + text.slice(at + remove);
  }
  return text;
}

/**
 * Where `brace` goes in the blanks from `from` to `to`: in place of the
 * blank just before `to`, at the end of the line `from` is on when the
 * blanks hold a line break, or else inserted at `to`.
 */
function brace(
  masked: string,
  from: number,
  to: number,
  text: string
): { at: number; remove: number; text: string } {
  const blanks = masked.slice(from, to);
  if (to > from && /[ \t]/.test(masked[to - 1])) {
    return { at: to - 1, remove: 1, text };
  }
  return blanks.indexOf('\n') === -1
    ? { at: to, remove: 0, text }
    : { at: from, remove: 0, text };
}

/** The identifier starting at `at`, or ''. */
function wordAt(masked: string, at: number): string {
  return at < masked.length && IDENT_START.test(masked[at])
    ? masked.slice(at, identifierEnd(masked, at))
    : '';
}

/**
 * The index just past the statement starting at or after `start`, or -1
 * where it does not end as a statement must.
 */
function statementEnd(masked: string, start: number): number {
  const at = skipSpace(masked, start);
  if (at >= masked.length) {
    return -1;
  }
  if (masked[at] === '{') {
    const close = matchBrace(masked, at);
    return close === -1 ? -1 : close + 1;
  }
  const word = wordAt(masked, at);
  const next = at + word.length;
  if (
    word === 'if' ||
    word === 'while' ||
    word === 'for' ||
    word === 'switch'
  ) {
    const close = parenthesesEnd(masked, next);
    const end = close === -1 ? -1 : statementEnd(masked, close);
    if (end === -1 || word !== 'if') {
      return end;
    }
    const otherwise = skipSpace(masked, end);
    return wordAt(masked, otherwise) === 'else'
      ? statementEnd(masked, otherwise + 4)
      : end;
  }
  if (word === 'do') {
    const end = statementEnd(masked, next);
    const condition = end === -1 ? -1 : skipSpace(masked, end);
    if (condition === -1 || wordAt(masked, condition) !== 'while') {
      return -1;
    }
    const close = parenthesesEnd(masked, condition + 5);
    const semicolon = close === -1 ? -1 : skipSpace(masked, close);
    return semicolon !== -1 && masked[semicolon] === ';' ? semicolon + 1 : -1;
  }
  // An expression statement, or a jump: up to its `;`.
  let depth = 0;
  for (let i = at; i < masked.length; i += 1) {
    const char = masked[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth < 0) {
        return -1;
      }
    } else if (char === ';' && depth === 0) {
      return i + 1;
    }
  }
  return -1;
}

/** The index just past the parenthesized part at or after `start`, or -1. */
function parenthesesEnd(masked: string, start: number): number {
  const open = skipSpace(masked, start);
  if (masked[open] !== '(') {
    return -1;
  }
  const close = matchParen(masked, open);
  return close === -1 ? -1 : close + 1;
}
