import strings from '../strings';

/**
 * The C the interpreter refuses to run, in one list.
 *
 * Each of these is valid C that unicoen cannot step: it either stops at the
 * construct in silence or runs on to a wrong answer, so the syntax check
 * refuses the program instead (`jscpp/JscppSyntax.ts`), with the message
 * below. The list is also written into the deploy's `library.json` (see
 * `app/libraryManifest.ts`), where a host that never runs the interpreter -
 * the course build's lint - reads which constructs a visualized block may
 * not contain.
 *
 * `pattern` is for that host. It is a regular expression in the syntax
 * JavaScript's `RegExp` and Python's `re` read alike: no lookbehind, no
 * named groups, no flags, no inline modifiers, only `\b`, `\s`, `\w`, classes,
 * groups and lookahead. It needs no flags because it never anchors to a line
 * with `^` alone: where it means "at the start of a statement" it says
 * `(?:^|[\n;{}])`. It is meant for source whose comments, string literals and
 * character constants have been blanked first (the lint's tokenizer does
 * that, and so does `scan.ts`'s `mask` here); on raw source a `goto` inside a
 * string would match. A pattern may find a construct the interpreter would
 * also have refused - it is a check that needs no parser, not the parser -
 * and every construct the interpreter refuses is found by its pattern. The
 * one known overlap: a conditional expression broken after its `?`, with a
 * name and the `:` on a line of their own (`c ?\n  a :\n  b`), reads as a
 * label to the pattern; the usual layout, `c\n  ? a\n  : b`, does not.
 *
 * Kept as limits rather than implemented, as the course's feature table
 * says: `goto` and a labelled statement cannot be stepped, and neither can
 * `>>=`. `<<=` is not here because it runs correctly (unicoen maps it; only
 * `>>=` loses its operator), which `test/refused-constructs.test.ts` checks.
 */

/** A construct's name in the list, which does not change once published. */
export type RefusedConstructId = 'goto' | 'label' | 'shift-right-assign';

export interface RefusedConstruct {
  id: RefusedConstructId;
  /** The construct as C spells it, for a finding to name. */
  construct: string;
  /** A regular expression that finds it in blanked source; see above. */
  pattern: string;
  /** What the editor says when it refuses the program. */
  message: string;
}

/**
 * The names a labelled statement's pattern must not take for a label:
 * `default:` is a switch label, and a type keyword before a colon is an
 * unnamed bit-field (`unsigned : 4;`). `case X:` cannot match, because a
 * label is one name and then the colon.
 */
const NOT_LABELS = [
  'default',
  'case',
  'int',
  'unsigned',
  'signed',
  'char',
  'short',
  'long',
  '_Bool',
  'bool',
];

export const REFUSED_CONSTRUCTS: readonly RefusedConstruct[] = [
  {
    id: 'goto',
    construct: 'goto',
    pattern: '\\bgoto\\b',
    message: strings.gotoUnsupported,
  },
  {
    // A name and a colon at the start of a statement: after the start of the
    // source, a line break, a `;`, a `{` or a `}`.
    id: 'label',
    construct: 'label:',
    pattern: `(?:^|[\\n;{}])\\s*(?!(?:${NOT_LABELS.join('|')})\\b)[A-Za-z_]\\w*\\s*:`,
    message: strings.labelUnsupported,
  },
  {
    id: 'shift-right-assign',
    construct: '>>=',
    pattern: '>>=',
    message: strings.shiftAssignUnsupported,
  },
];

/** One construct of the list, by its name. */
export function refusedConstruct(id: RefusedConstructId): RefusedConstruct {
  const found = REFUSED_CONSTRUCTS.find((construct) => construct.id === id);
  if (typeof found === 'undefined') {
    throw new Error(`no refused construct ${id}`);
  }
  return found;
}
