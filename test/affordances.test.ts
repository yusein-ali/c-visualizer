import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { foldable } from '@codemirror/language';
import { Expansion } from '../src/interpreter/Expansion';
import {
  coverageField,
  excludedRegionFolding,
  expansionListField,
  setCoverage,
  showStep,
} from '../src/ui/editor';
import { setExpansions } from '../src/ui/editor/expansions';
import { stepHighlightField } from '../src/ui/editor/stepHighlight';
import { Server } from '../src/core';

/**
 * The affordances of item 9: the ones with an answer to check.
 *
 * Three of them are decisions rather than behaviour - `drawSelection`,
 * `rectangularSelection` and the rest are extensions being present in a list -
 * and checking that a list contains what it contains teaches nothing. What is
 * here is the three that compute something: which lines the run has been to,
 * which region a `#if 0` folds away, and what a screen reader is told.
 */

const stateWith = (doc: string, ...extensions: any[]) =>
  EditorState.create({ doc, extensions });

describe('the coverage gutter', () => {
  const doc = ['int main() {', '  int i = 0;', '  return i;', '}'].join('\n');

  it('marks the lines the run has been to and no others', () => {
    let state = stateWith(doc, coverageField);
    expect(state.field(coverageField).size).toBe(0);
    state = state.update({
      effects: setCoverage.of([
        { line: 2, count: 1 },
        { line: 3, count: 40 },
      ]),
    }).state;
    expect(state.field(coverageField).size).toBe(2);
  });

  it('shades a line that ran often darker than one that ran once', () => {
    const state = stateWith(doc, coverageField).update({
      effects: setCoverage.of([
        { line: 2, count: 1 },
        { line: 3, count: 40 },
      ]),
    }).state;
    const classes: string[] = [];
    state
      .field(coverageField)
      .between(0, state.doc.length, (_from, _to, marker) => {
        classes.push(marker.elementClass);
      });
    expect(classes[0]).toContain('plivet-coverage--1');
    expect(classes[1]).toContain('plivet-coverage--4');
  });

  it('drops a count for a line the reader has since deleted', () => {
    const state = stateWith(doc, coverageField).update({
      effects: setCoverage.of([{ line: 99, count: 3 }]),
    }).state;
    expect(state.field(coverageField).size).toBe(0);
  });

  it('counts every line the run arrives at, not only the ones shown', () => {
    // The point of counting in the interpreter: a run reports twice and takes
    // many steps in between.
    const server = new Server();
    const log = console.log;
    console.log = () => undefined;
    return server
      .send({
        controlEvent: 'Start',
        sourcecode:
          'int main(void) {\n  int total = 0;\n  for (int i = 0; i < 3; i++) {\n    total = total + i;\n  }\n  return total;\n}',
      })
      .then(() =>
        server.send({
          controlEvent: 'Step',
          sourcecode: '',
        })
      )
      .then((response) => {
        console.log = log;
        const counts = response.coverage ?? [];
        expect(counts.length).toBeGreaterThan(0);
        expect(counts.every((entry) => entry.count >= 1)).toBe(true);
      });
  });
});

describe('folding what the compiler never saw', () => {
  const doc = [
    '#if 0',
    '  int unused = 1;',
    '  int also = 2;',
    '#endif',
    'int main() { return 0; }',
  ].join('\n');

  const excluded = (line: number): Expansion => ({
    kind: 'excluded',
    line,
    column: 0,
    length: 1,
    name: '#if',
    text: '',
  });

  const withExcluded = (...lines: number[]) =>
    stateWith(doc, [expansionListField, excludedRegionFolding]).update({
      effects: setExpansions.of(lines.map(excluded)),
    }).state;

  it('folds the run of excluded lines from the first of them', () => {
    const state = withExcluded(2, 3);
    const first = state.doc.line(2);
    const range = foldable(state, first.from, first.to);
    expect(range).not.toBeNull();
    expect(range!.to).toBe(state.doc.line(3).to);
  });

  it('offers the fold on the first line of the run and no other', () => {
    const state = withExcluded(2, 3);
    const second = state.doc.line(3);
    expect(foldable(state, second.from, second.to)).toBeNull();
  });

  it('leaves a single excluded line alone', () => {
    // The marker would take as much room as the line it hid.
    const state = withExcluded(2);
    const first = state.doc.line(2);
    expect(foldable(state, first.from, first.to)).toBeNull();
  });
});

describe('what a screen reader is told', () => {
  it('reads out the statement and what its variables hold', () => {
    const said: string[] = [];
    const view = new EditorView({
      state: stateWith(
        'int main() {\n  total = total + 1;\n}',
        stepHighlightField
      ),
    });
    // `announce` lands in a live region the view maintains, so the effect on
    // the transaction is what says it was sent at all.
    const line = view.state.doc.line(2);
    view.dispatch = ((transaction: any) => {
      for (const effect of transaction.effects) {
        if (typeof effect.value === 'string') {
          said.push(effect.value);
        }
      }
    }) as any;
    showStep(
      view,
      {
        range: { from: line.from + 2, to: line.to },
        values: [{ name: 'total', display: '3' }],
      },
      false
    );
    expect(said[0]).toBe('line 2: total = total + 1;. total 3');
    view.destroy();
  });

  it('centres a debug step vertically without changing horizontal scroll', () => {
    const view = new EditorView({
      state: stateWith(
        'int main() {\n                    return 0;\n}',
        stepHighlightField
      ),
    });
    const line = view.state.doc.line(2);
    const requested: any[] = [];
    view.requestMeasure = ((request: any) => requested.push(request)) as any;
    view.scrollDOM.scrollLeft = 37;

    showStep(view, {
      range: { from: line.from + 20, to: line.to },
      values: [],
    });

    const vertical = requested.find((request) => request?.write !== undefined);
    expect(vertical).toBeDefined();
    const measurement = vertical.read(view);
    vertical.write(measurement, view);
    expect(view.scrollDOM.scrollLeft).toBe(37);
    view.destroy();
  });
});
