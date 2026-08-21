import { EditorState } from '@codemirror/state';
import { foldService } from '@codemirror/language';
import { expansionListField } from './expansions';

/**
 * Folding the parts of the file the compiler never saw.
 *
 * A function body folds already: `@codemirror/lang-cpp` marks its blocks and
 * `foldGutter` finds them. What no language package can know is which lines a
 * conditional directive kept out - that is the preprocessor's answer, and
 * PLIVET's preprocessor already reports it as an `excluded` expansion. A
 * `#if 0` block a reader has to scroll past is the one region of a C file
 * that is certainly not worth reading, so it is the one worth folding.
 *
 * A fold service answers for a line: given where a line starts, either the
 * range to fold from there or nothing. So the run of excluded lines is folded
 * from the first of them, and only from the first - a service that answered
 * for every line of the run would offer a fold on each of them.
 */

/** Which lines a conditional kept out, as a set of 1-based line numbers. */
const excludedLines = (state: EditorState): Set<number> => {
  const lines = new Set<number>();
  for (const expansion of state.field(expansionListField, false) ?? []) {
    if (expansion.kind === 'excluded') {
      lines.add(expansion.line);
    }
  }
  return lines;
};

export const excludedRegionFolding = foldService.of(
  (state: EditorState, lineStart: number, lineEnd: number) => {
    const excluded = excludedLines(state);
    if (excluded.size === 0) {
      return null;
    }
    const line = state.doc.lineAt(lineStart).number;
    if (!excluded.has(line) || excluded.has(line - 1)) {
      return null;
    }
    let last = line;
    while (excluded.has(last + 1) && last + 1 <= state.doc.lines) {
      last += 1;
    }
    // A single excluded line has nothing worth folding: the fold marker would
    // take up as much room as the line it hides.
    if (last === line) {
      return null;
    }
    return { from: lineEnd, to: state.doc.line(last).to };
  }
);
