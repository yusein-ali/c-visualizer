import { RangeSet, StateEffect, StateField } from '@codemirror/state';
import { EditorView, GutterMarker, gutterLineClass } from '@codemirror/view';

/**
 * How often the run has been to each line, shaded into the gutter.
 *
 * It is the cheapest picture of control flow there is. A loop body darkens as
 * it runs, the line after a `return` never darkens at all, and a branch the
 * program never took stays as pale as the blank lines around it - three
 * things a reader would otherwise learn by stepping and remembering.
 *
 * The counting is the interpreter's, not the editor's: a run reports two
 * responses and takes thousands of steps between them, so anything counted on
 * this side would be a count of what the reader happened to be shown.
 */

/** Line counts as the interpreter reports them: 1-based lines. */
export interface LineCoverage {
  line: number;
  count: number;
}

export const setCoverage = StateEffect.define<LineCoverage[]>();

/**
 * Four bands rather than a gradient. A reader is asking whether a line ran,
 * whether it ran often, and whether it ran far more often than its
 * neighbours; a continuous shade answers a question about exact counts that
 * nobody is asking of a gutter.
 */
const bandFor = (count: number): number => {
  if (count <= 1) {
    return 1;
  }
  if (count <= 5) {
    return 2;
  }
  if (count <= 25) {
    return 3;
  }
  return 4;
};

class CoverageMarker extends GutterMarker {
  constructor(private readonly band: number) {
    super();
  }

  elementClass = `plivet-coverage plivet-coverage--${this.band}`;

  eq(other: CoverageMarker): boolean {
    return other.band === this.band;
  }
}

const markers = [1, 2, 3, 4].map((band) => new CoverageMarker(band));

const setFor = (
  state: EditorView['state'],
  counts: LineCoverage[]
): RangeSet<GutterMarker> => {
  const ranges = counts
    // A line past the end of the document is one the reader has since
    // deleted; the run it belongs to is still the one that is running, so it
    // is dropped rather than argued with.
    .filter((entry) => 1 <= entry.line && entry.line <= state.doc.lines)
    .map((entry) => ({
      from: state.doc.line(entry.line).from,
      marker: markers[bandFor(entry.count) - 1],
    }))
    .sort((a, b) => a.from - b.from);
  return RangeSet.of(
    ranges.map((entry) => entry.marker.range(entry.from)),
    true
  );
};

export const coverageField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(coverage, transaction) {
    let updated = coverage.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setCoverage)) {
        updated = setFor(transaction.state, effect.value);
      }
    }
    return updated;
  },
  provide: (field) => gutterLineClass.from(field),
});

export const showCoverage = (
  view: EditorView,
  counts: LineCoverage[]
): void => {
  view.dispatch({ effects: setCoverage.of(counts) });
};
