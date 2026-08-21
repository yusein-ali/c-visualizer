import { EditorState } from '@codemirror/state';
import { EditorView, showTooltip } from '@codemirror/view';
import {
  setWatchRecords,
  toggleWatch,
  watchField,
  watchNames,
} from '../src/ui/editor';
import { HoverTextSource } from '../src/app/hoverText';

/**
 * A watch window with no window.
 *
 * The values a debugger's watch pane shows are already in the document,
 * beside the names they belong to, so a pinned tooltip stays where the name
 * is written. What is checked here is the three things that makes a watch
 * rather than a hover: it stays, it follows its name through an edit, and it
 * is rewritten at every step.
 */

const doc = 'int main() {\n  int count = 7;\n  return count;\n}';

const stateWith = (...names: { name: string; pos: number }[]) => {
  let state = EditorState.create({ doc, extensions: [watchField] });
  for (const watch of names) {
    state = state.update({ effects: toggleWatch.of(watch) }).state;
  }
  return state;
};

const tooltipsOf = (state: EditorState) =>
  state.facet(showTooltip).filter((tooltip) => tooltip !== null);

describe('pinned watches', () => {
  it('keeps a tooltip standing at the name that was pinned', () => {
    const at = doc.indexOf('count');
    const state = stateWith({ name: 'count', pos: at });
    expect(watchNames(state)).toEqual(['count']);
    const shown = tooltipsOf(state);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.pos).toBe(at);
  });

  it('takes the pin off the second time', () => {
    const at = doc.indexOf('count');
    const state = stateWith(
      { name: 'count', pos: at },
      { name: 'count', pos: at }
    );
    expect(watchNames(state)).toEqual([]);
    expect(tooltipsOf(state)).toHaveLength(0);
  });

  it('moves a watch down when the text above it grows', () => {
    const at = doc.indexOf('count');
    let state = stateWith({ name: 'count', pos: at });
    state = state.update({
      changes: { from: 0, insert: '// a comment\n' },
    }).state;
    expect(tooltipsOf(state)[0]!.pos).toBe(at + '// a comment\n'.length);
  });

  it('drops a watch whose name was deleted', () => {
    const at = doc.indexOf('count');
    let state = stateWith({ name: 'count', pos: at });
    state = state.update({
      changes: { from: at, to: at + 'count'.length },
    }).state;
    expect(watchNames(state)).toEqual([]);
  });

  it('shows what the name holds now, and says so when it holds nothing yet', () => {
    const at = doc.indexOf('count');
    const state = stateWith({ name: 'count', pos: at });
    const view = new EditorView({ state });

    const before = view.state.facet(showTooltip)[0]!.create(view);
    expect(before.dom.textContent).toContain('count');

    view.dispatch({
      effects: setWatchRecords.of([
        {
          name: 'count',
          record: {
            title: 'count',
            facts: [{ label: 'value', value: '7' }],
          },
        },
      ]),
    });
    const after = view.state.facet(showTooltip)[0]!.create(view);
    expect(after.dom.textContent).toContain('7');
    view.destroy();
  });

  it('says a pinned name is out of the frame rather than vanishing', () => {
    const hover = new HoverTextSource();
    hover.setStep({
      stacks: [],
      pointers: [],
      memory: [],
      functions: [],
      expression: null,
      variables: [],
      inlineValues: [],
      constructStates: [],
      evaluations: [],
      codeRange: null,
    });
    const record = hover.watchRecord('count');
    expect(record.title).toBe('count');
    expect(record.facts[0].label).toContain('frame');
  });
});
