import { MapMode, StateEffect, StateField } from '@codemirror/state';
import { EditorView, showTooltip, Tooltip } from '@codemirror/view';
import { HoverRecord, hoverDom } from './tooltip';

/**
 * Watches: the tooltips a reader has pinned to a name, kept on the screen and
 * rewritten at every step.
 *
 * This is a watch window with no window. The values a debugger's watch pane
 * shows are already in the document - beside the name they belong to - and a
 * pane on the far side of the editor asks the reader to hold a second copy of
 * the program in their head to use it. A pinned tooltip stays where the name
 * is written, so what it says is read in the place it is about.
 *
 * The gesture is alt-click on a name, and alt-click again to take it away.
 * Not a plain click: a plain click is how a reader moves the cursor, and a
 * watch pinned by every cursor move is not a watch window but a mess.
 */

/** A pinned name and where it was pinned, so the tooltip stays with it. */
export interface Watch {
  name: string;
  pos: number;
}

/** What a watch shows: the same record the hover tooltip would have shown. */
export interface WatchRecord {
  name: string;
  record: HoverRecord;
}

interface WatchState {
  pins: Watch[];
  shown: WatchRecord[];
}

/** Pin a name, or take the pin off it if it is already pinned. */
export const toggleWatch = StateEffect.define<Watch>();

/** What the pinned names hold now. Sent at every step. */
export const setWatchRecords = StateEffect.define<WatchRecord[]>();

const empty: WatchState = { pins: [], shown: [] };

const watchTooltip = (watch: Watch, shown: WatchRecord[]): Tooltip => {
  const found = shown.find((record) => record.name === watch.name);
  return {
    pos: watch.pos,
    above: true,
    // Not strictly a hover: a pinned tooltip is arrowed to the name it
    // belongs to, because several of them stand at once and an unattached box
    // is a value with nothing to say which name it is the value of.
    arrow: true,
    create: () => {
      const record: HoverRecord =
        typeof found === 'undefined'
          ? { title: watch.name, facts: [] }
          : found.record;
      const dom = hoverDom(record);
      dom.classList.add('plivet-watch');
      return { dom };
    },
  };
};

export const watchField = StateField.define<WatchState>({
  create: () => empty,
  update(watches, transaction) {
    let pins = watches.pins;
    let shown = watches.shown;
    if (transaction.docChanged) {
      // A watch is pinned to a place in the text. An edit above it moves it;
      // an edit that deletes the name it was on takes the watch with it,
      // rather than leaving a value floating over whatever moved into that
      // position.
      pins = pins.flatMap((watch) => {
        // `TrackAfter`, because a watch sits at the first character of the
        // name it belongs to: what has to survive is the name after the
        // position, not the position itself, which an edit ending there would
        // leave standing over whatever moved in.
        const moved = transaction.changes.mapPos(
          watch.pos,
          1,
          MapMode.TrackAfter
        );
        return moved === null ? [] : [{ ...watch, pos: moved }];
      });
    }
    for (const effect of transaction.effects) {
      if (effect.is(toggleWatch)) {
        const wanted = effect.value;
        const already = pins.some((watch) => watch.name === wanted.name);
        pins = already
          ? pins.filter((watch) => watch.name !== wanted.name)
          : pins.concat(wanted);
      }
      if (effect.is(setWatchRecords)) {
        shown = effect.value;
      }
    }
    return pins === watches.pins && shown === watches.shown
      ? watches
      : { pins, shown };
  },
  provide: (field) =>
    showTooltip.computeN([field], (state) => {
      const { pins, shown } = state.field(field);
      return pins.map((watch) => watchTooltip(watch, shown));
    }),
});

/** The names pinned at the moment, for whoever has to find their values. */
export const watchNames = (state: EditorView['state']): string[] =>
  state.field(watchField, false)?.pins.map((watch) => watch.name) ?? [];

export const showWatchRecords = (
  view: EditorView,
  records: WatchRecord[]
): void => {
  view.dispatch({ effects: setWatchRecords.of(records) });
};

/**
 * Alt-click on a name pins it; alt-click again takes it off. The handler
 * answers `true` only when it has done something, so an alt-click anywhere
 * else is still the editor's own.
 */
export const watchGesture = (onChange: () => void) =>
  EditorView.domEventHandlers({
    mousedown(event: MouseEvent, view: EditorView) {
      if (!event.altKey) {
        return false;
      }
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) {
        return false;
      }
      const word = view.state.wordAt(pos);
      if (word === null) {
        return false;
      }
      event.preventDefault();
      view.dispatch({
        effects: toggleWatch.of({
          name: view.state.sliceDoc(word.from, word.to),
          pos: word.from,
        }),
      });
      onChange();
      return true;
    },
  });
