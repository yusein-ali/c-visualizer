import { EditorState } from '@codemirror/state';
import {
  activateHover,
  EditorView,
  hasHoverTooltips,
  showTooltip,
} from '@codemirror/view';
import {
  DebugExtensions,
  setWatchRecords,
  toggleWatch,
  watchField,
  watchNames,
} from '../src/ui/editor';
import { HoverTextSource } from '../src/app/hoverText';
import { emptyStepModel } from '../src/core';

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

  it('says a pinned identifier is not visible rather than vanishing', () => {
    const hover = new HoverTextSource();
    hover.setStep(emptyStepModel());
    const record = hover.watchRecord('count');
    expect(record.title).toBe('count');
    expect(record.facts[0].label).toContain('not visible');
  });
});

describe('pinning an ordinary hover', () => {
  const at = doc.indexOf('count');
  const makeView = (onWatchesChanged?: () => void) =>
    new EditorView({
      doc,
      parent: document.body,
      extensions: new DebugExtensions({
        hoverText: ({ word }) => ({
          title: word,
          facts: [{ label: 'value', value: '7' }],
        }),
        onWatchesChanged,
      }).extensions,
    });
  const hover = async (view: EditorView, pos = at) => {
    activateHover(view, pos, 1);
    await Promise.resolve();
    await Promise.resolve();
    return view.dom.querySelector<HTMLElement>('.cm-tooltip-hover')!;
  };

  it('offers an unpressed pin on hover without creating a watch', async () => {
    const changed = jest.fn();
    const view = makeView(changed);
    try {
      const dom = await hover(view);
      const pin = dom.querySelector<HTMLButtonElement>('.plivet-watch__pin')!;
      expect(pin.getAttribute('aria-pressed')).toBe('false');
      expect(pin.getAttribute('aria-label')).toBe('Pin count as a live watch');
      expect(watchNames(view.state)).toEqual([]);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      view.destroy();
    }
  });

  it('pins from hover, closes the transient copy, and keeps updating the value', async () => {
    const changed = jest.fn();
    const view = makeView(changed);
    try {
      const dom = await hover(view);
      const pin = dom.querySelector<HTMLButtonElement>('.plivet-watch__pin')!;
      const before = view.state.selection;
      const down = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      pin.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      pin.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(watchNames(view.state)).toEqual(['count']);
      expect(view.state.selection.eq(before)).toBe(true);
      expect(hasHoverTooltips(view.state)).toBe(false);
      expect(changed).toHaveBeenCalledTimes(1);
      document.body.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true })
      );
      expect(watchNames(view.state)).toEqual(['count']);
      view.dispatch({
        effects: setWatchRecords.of([
          {
            name: 'count',
            record: { title: 'count', facts: [{ label: 'value', value: '8' }] },
          },
        ]),
      });
      const standing = view.dom.querySelector<HTMLElement>('.plivet-watch')!;
      expect(standing.textContent).toContain('8');
      expect(
        standing.querySelector('button')!.getAttribute('aria-pressed')
      ).toBe('true');
    } finally {
      view.destroy();
    }
  });

  it('does not offer pins without a listener to supply watched values', async () => {
    const view = makeView();
    try {
      expect(
        (await hover(view)).querySelector('.plivet-watch__pin')
      ).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it('can release a pinned name from a later hover without leaving a stale pin', async () => {
    const changed = jest.fn();
    const view = makeView(changed);
    try {
      view.dispatch({ effects: toggleWatch.of({ name: 'count', pos: at }) });
      const dom = await hover(view);
      const pin = dom.querySelector<HTMLButtonElement>('.plivet-watch__pin')!;
      expect(pin.getAttribute('aria-pressed')).toBe('true');
      pin.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(watchNames(view.state)).toEqual([]);
      expect(hasHoverTooltips(view.state)).toBe(false);
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      view.destroy();
    }
  });

  it('does not offer a pin for a numeric literal', async () => {
    const view = makeView(jest.fn());
    try {
      expect(
        (await hover(view, doc.indexOf('7'))).querySelector(
          '.plivet-watch__pin'
        )
      ).toBeNull();
    } finally {
      view.destroy();
    }
  });
});

describe('the pin on a watch', () => {
  const at = doc.indexOf('count');
  const pinned = () =>
    new EditorView({
      state: stateWith({ name: 'count', pos: at }),
      parent: document.body,
    });
  const shownIn = (view: EditorView) =>
    view.state.facet(showTooltip)[0]!.create(view);
  const pinOf = (dom: HTMLElement) =>
    dom.querySelector<HTMLButtonElement>('.plivet-watch__pin')!;
  const press = (button: HTMLElement) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));

  it('marks a pinned watch as pinned', () => {
    const view = pinned();
    const { dom } = shownIn(view);
    expect(dom.classList.contains('plivet-watch--latched')).toBe(true);
    expect(pinOf(dom).getAttribute('aria-pressed')).toBe('true');
    view.destroy();
  });

  it('lets the watch go when pressed, and leaves it standing under the pointer', () => {
    const view = pinned();
    press(pinOf(shownIn(view).dom));
    expect(watchNames(view.state)).toEqual([]);
    expect(tooltipsOf(view.state)).toHaveLength(1);
    const { dom } = shownIn(view);
    expect(dom.classList.contains('plivet-watch--latched')).toBe(false);
    expect(pinOf(dom).getAttribute('aria-pressed')).toBe('false');
    view.destroy();
  });

  it('takes a released watch away when the pointer moves off it', () => {
    const view = pinned();
    press(pinOf(shownIn(view).dom));
    // The tooltip the editor itself put on the page, not one made for the
    // test: it is the one whose leaving is listened for.
    const standing = view.dom.querySelector<HTMLElement>('.plivet-watch')!;
    standing.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(tooltipsOf(view.state)).toHaveLength(1);
    document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(tooltipsOf(view.state)).toHaveLength(0);
    view.destroy();
  });

  it('pins a released watch again when its pin is pressed', () => {
    const view = pinned();
    press(pinOf(shownIn(view).dom));
    press(pinOf(shownIn(view).dom));
    expect(watchNames(view.state)).toEqual(['count']);
    expect(shownIn(view).dom.classList.contains('plivet-watch--latched')).toBe(
      true
    );
    view.destroy();
  });

  it('removes the watch at once when the pin is pressed from the keyboard', () => {
    const view = pinned();
    pinOf(shownIn(view).dom).dispatchEvent(
      new MouseEvent('click', { bubbles: true, detail: 0 })
    );
    expect(tooltipsOf(view.state)).toHaveLength(0);
    view.destroy();
  });
});
