import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { Expansion } from '../../interpreter/Expansion';
import { offsetAt } from './positions';

/**
 * The marks under everything the preprocessor touched. The pass keeps line
 * numbers, so a recorded position still refers to the line the user is looking
 * at and the mark can sit directly under the macro they wrote.
 */

export const setExpansions = StateEffect.define<Expansion[]>();

// `enum` falls to the same grey as an excluded region, which is where Ace's
// three-way choice of style left it. The tooltip still names what it became.
const isInactive = (expansion: Expansion): boolean =>
  expansion.kind === 'excluded' ||
  (expansion.kind === 'directive' && expansion.active === false);

const markFor = (expansion: Expansion) =>
  Decoration.mark({
    class:
      expansion.kind === 'macro'
        ? 'plivet-macro-expansion'
        : expansion.kind === 'directive' && !isInactive(expansion)
          ? 'plivet-directive-line'
          : 'plivet-excluded-region',
  });

const preprocessorToken = {
  macro: Decoration.mark({ class: 'plivet-preprocessor-macro' }),
  number: Decoration.mark({ class: 'plivet-preprocessor-number' }),
  operator: Decoration.mark({ class: 'plivet-preprocessor-operator' }),
  keyword: Decoration.mark({ class: 'plivet-preprocessor-keyword' }),
  punctuation: Decoration.mark({ class: 'plivet-preprocessor-punctuation' }),
  literal: Decoration.mark({ class: 'plivet-preprocessor-literal' }),
  comment: Decoration.mark({ class: 'plivet-preprocessor-comment' }),
};

/**
 * `@codemirror/lang-cpp` treats a conditional directive's whole argument as
 * generic metadata. The preprocessor knows that it is an integer expression,
 * so mark its tokens with the roles a C expression normally receives.
 */
const conditionalTokenMarks = (
  state: EditorState,
  expansion: Expansion
): { from: number; to: number; mark: Decoration }[] => {
  if (
    expansion.kind !== 'directive' ||
    !['#if', '#elif', '#ifdef', '#ifndef'].includes(expansion.name) ||
    expansion.line < 1 ||
    expansion.line > state.doc.lines
  ) {
    return [];
  }
  const line = state.doc.line(expansion.line);
  const source = line.text.slice(expansion.column);
  const prefix = /^\s*#\s*(?:if|elif|ifdef|ifndef)\b\s*/.exec(source);
  if (prefix === null) {
    return [];
  }
  const argument = source.slice(prefix[0].length);
  const base = line.from + expansion.column + prefix[0].length;
  const tokens: { from: number; to: number; mark: Decoration }[] = [];
  const pattern =
    /\/\*.*?\*\/|\/\/.*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+[uUlL]*|[0-9]+[uUlL]*|&&|\|\||==|!=|<=|>=|<<|>>|[!~+\-*/%<>&^|?:]|[()[\],]/g;
  for (const match of argument.matchAll(pattern)) {
    const text = match[0];
    const from = base + (match.index ?? 0);
    const mark =
      text.startsWith('//') || text.startsWith('/*')
        ? preprocessorToken.comment
        : text.startsWith("'") || text.startsWith('"')
          ? preprocessorToken.literal
          : text === 'defined'
            ? preprocessorToken.keyword
            : /^[A-Za-z_]/.test(text)
              ? preprocessorToken.macro
              : /^[0-9]/.test(text)
                ? preprocessorToken.number
                : /^[()[\],]$/.test(text)
                  ? preprocessorToken.punctuation
                  : preprocessorToken.operator;
    tokens.push({ from, to: from + text.length, mark });
  }
  return tokens;
};

const decorationsFor = (
  state: EditorState,
  expansions: Expansion[]
): DecorationSet => {
  const marks = expansions
    .map((expansion) => {
      const from = offsetAt(state.doc, expansion.line, expansion.column);
      const to = offsetAt(
        state.doc,
        expansion.line,
        expansion.column + expansion.length
      );
      return { from, to, expansion };
    })
    // A zero-length mark is not a decoration CodeMirror will accept, and a
    // replacement that fell off the end of an edited line has no width.
    .filter((span) => span.to > span.from)
    .map((span) => markFor(span.expansion).range(span.from, span.to));
  const inactiveLines = new Set(
    expansions
      .filter(isInactive)
      .map((expansion) => expansion.line)
      .filter((line) => 1 <= line && line <= state.doc.lines)
  );
  const lineMarks = Array.from(inactiveLines).map((line) =>
    Decoration.line({ class: 'plivet-inactive-line' }).range(
      state.doc.line(line).from
    )
  );
  const tokenMarks = expansions.flatMap((expansion) =>
    conditionalTokenMarks(state, expansion).map(({ from, to, mark }) =>
      mark.range(from, to)
    )
  );
  return Decoration.set(marks.concat(lineMarks, tokenMarks), true);
};

/**
 * The expansions themselves, beside the marks made from them.
 *
 * The marks are what the reader sees; the list is what has to be asked
 * questions - which lines a conditional kept out of the program, so they can
 * be folded away. Recording it here rather than recovering it from the
 * decorations keeps one effect as the one way expansions arrive.
 */
export const expansionListField = StateField.define<Expansion[]>({
  create: () => [],
  update(expansions, transaction) {
    let updated = expansions;
    for (const effect of transaction.effects) {
      if (effect.is(setExpansions)) {
        updated = effect.value;
      }
    }
    return updated;
  },
});

export const expansionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, transaction) {
    let updated = marks.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setExpansions)) {
        updated = decorationsFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const showExpansions = (
  view: EditorView,
  expansions: Expansion[]
): void => {
  view.dispatch({ effects: setExpansions.of(expansions) });
};

/**
 * The replacement covering a position, narrowest first: a macro named inside a
 * directive sits within the span of the directive itself, and it is the more
 * specific answer.
 */
export const expansionAt = (
  expansions: Expansion[],
  line: number,
  column: number
): Expansion | null => {
  let found: Expansion | null = null;
  for (const expansion of expansions) {
    if (
      expansion.line === line &&
      expansion.column <= column &&
      column < expansion.column + expansion.length &&
      (found === null || expansion.length < found.length)
    ) {
      found = expansion;
    }
  }
  return found;
};
