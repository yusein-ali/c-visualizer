import { EditorState } from '@codemirror/state';
import {
  editableRegions,
  protectedField,
  protectedRegions,
  setEditableRegions,
  unprotected,
} from '../src/ui/editor';

/**
 * A program that is mostly given, with the part under study left blank.
 *
 * Left to a comment saying "do not edit below this line" it is an
 * instruction; as a filter it is the editor's own behaviour, and a student who
 * does not read instructions gets the same lesson as one who does.
 */

const doc = 'int main() {\n  return 0;\n}';
/** The `0` in the return statement, and nothing else. */
const blank = { from: doc.indexOf('return 0') + 7, to: doc.indexOf('0;') + 1 };

const stateWith = (...regions: { from: number; to: number }[]) => {
  const state = EditorState.create({
    doc,
    extensions: [protectedField, protectedRegions],
  });
  return regions.length === 0
    ? state
    : state.update({ effects: setEditableRegions.of(regions) }).state;
};

describe('protected regions', () => {
  it('edits anywhere when no region has been declared', () => {
    const state = stateWith();
    expect(editableRegions(state)).toEqual([]);
    const after = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(after.doc.toString().startsWith('x')).toBe(true);
  });

  it('refuses an edit outside the blank', () => {
    const state = stateWith(blank);
    const after = state.update({ changes: { from: 0, insert: 'x' } }).state;
    expect(after.doc.toString()).toBe(doc);
  });

  it('accepts an edit inside the blank', () => {
    const state = stateWith(blank);
    const after = state.update({
      changes: { from: blank.from, to: blank.to, insert: '42' },
    }).state;
    expect(after.doc.toString()).toContain('return 42;');
  });

  it('grows the blank with what is typed into it', () => {
    let state = stateWith(blank);
    state = state.update({
      changes: { from: blank.to, insert: '42' },
    }).state;
    const [region] = editableRegions(state);
    expect(region.to - region.from).toBe(blank.to - blank.from + 2);
    // And the enlarged blank still takes an edit at its far end.
    const after = state.update({
      changes: { from: region.to, insert: '7' },
    }).state;
    expect(after.doc.toString()).toContain('return 0427;');
  });

  it('refuses an edit that spans the edge of the blank', () => {
    const state = stateWith(blank);
    const after = state.update({
      changes: { from: blank.from - 3, to: blank.to, insert: 'x' },
    }).state;
    expect(after.doc.toString()).toBe(doc);
  });

  it('drops a refused transaction whole, selection and all', () => {
    // The selection it carries was worked out against the document the edit
    // would have made; a cursor placed by a refused edit is worse than one
    // left where the reader put it.
    const state = stateWith(blank);
    const after = state.update({
      changes: { from: 0, insert: 'x' },
      selection: { anchor: 4 },
    }).state;
    expect(after.doc.toString()).toBe(doc);
    expect(after.selection.main.anchor).toBe(0);
  });

  it('lets the application replace the whole program', () => {
    const state = stateWith(blank);
    const after = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'int main() {}' },
      annotations: unprotected.of(true),
    }).state;
    expect(after.doc.toString()).toBe('int main() {}');
  });
});
