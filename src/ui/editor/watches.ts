import { Facet, MapMode, StateEffect, StateField } from '@codemirror/state';
import {
  closeHoverTooltips,
  EditorView,
  showTooltip,
  Tooltip,
} from '@codemirror/view';
import { HoverContext, HoverRecord, hoverDom } from './tooltip';
import strings from '../../strings';

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
 * The pin on a hover keeps it standing. Alt-click on a name is a shortcut,
 * and alt-click again takes it away.
 * Not a plain click: a plain click is how a reader moves the cursor, and a
 * watch pinned by every cursor move is not a watch window but a mess.
 *
 * A pinned tooltip says that it is pinned: it carries a pin in its corner,
 * pressed in. The pin is also the way out for a reader who never learned the
 * gesture - pressing it lets the watch go. A watch let go that way does not
 * vanish from under the pointer that pressed it: it stands, unpinned, for as
 * long as the pointer stays on it, and pressing the pin again puts it back.
 */

/** A pinned name and where it was pinned, so the tooltip stays with it. */
export interface Watch {
  name: string;
  pos: number;
  /**
   * Let go by its pin, and standing only until the pointer leaves it. It is
   * no longer a watch for anything that asks which names are pinned.
   */
  released?: boolean;
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

/**
 * Let go of a pinned name without taking its tooltip away yet: the pointer
 * that pressed the pin is still on it.
 */
export const releaseWatch = StateEffect.define<string>();

/** Take a name's tooltip away, pinned or let go. */
export const removeWatch = StateEffect.define<string>();

/**
 * Who is told when the pins change by hand. The pin on a tooltip has to tell
 * the same listener the gesture tells, and a tooltip is made by the state,
 * which has no listener of its own to hand it.
 */
const watchChanged = Facet.define<() => void>();

const notify = (view: EditorView): void => {
  for (const changed of view.state.facet(watchChanged)) {
    changed();
  }
};

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
    create: (view) => {
      const record: HoverRecord =
        typeof found === 'undefined'
          ? { title: watch.name, facts: [] }
          : found.record;
      const dom = hoverDom(record);
      const released = watch.released === true;
      dom.classList.add('plivet-watch');
      dom.classList.toggle('plivet-watch--latched', !released);
      dom.prepend(pinButton(view, watch));
      if (!released) {
        return { dom };
      }
      // A released watch goes when the pointer is no longer on it. The
      // document is asked rather than the tooltip: the tooltip was rebuilt
      // under a pointer that has not moved, and one that never entered it
      // would never be told it left.
      const leave = (event: MouseEvent) => {
        const box = dom.closest('.cm-tooltip') ?? dom;
        if (event.target instanceof Node && box.contains(event.target)) {
          return;
        }
        view.dispatch({ effects: removeWatch.of(watch.name) });
      };
      const doc = view.dom.ownerDocument;
      doc.addEventListener('mousemove', leave);
      return {
        dom,
        destroy: () => doc.removeEventListener('mousemove', leave),
      };
    },
  };
};

/**
 * The pin in a watch's corner: pressed in while the watch is pinned, and the
 * button that lets it go.
 */
const pinButton = (view: EditorView, watch: Watch): HTMLButtonElement => {
  const released = watch.released === true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plivet-watch__pin';
  button.setAttribute('aria-pressed', released ? 'false' : 'true');
  const label = (released ? strings.watchPin : strings.watchUnpin).replace(
    '{name}',
    watch.name
  );
  button.title = label;
  button.setAttribute('aria-label', label);
  button.textContent = '\u{1F4CC}\uFE0E';
  // The press must not take the focus out of the editor, nor reach it as a
  // click on the text under the tooltip.
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    if (released) {
      view.dispatch({
        effects: [
          toggleWatch.of({ name: watch.name, pos: watch.pos }),
          closeHoverTooltips,
        ],
      });
    } else {
      // A press from the keyboard has no pointer resting on the tooltip to
      // wait for, so there the watch simply goes.
      const effect = event.detail === 0 ? removeWatch : releaseWatch;
      view.dispatch({ effects: [effect.of(watch.name), closeHoverTooltips] });
    }
    notify(view);
  });
  return button;
};

/** The same pin, initially released, on an identifier's ordinary hover. */
export const decorateWatchHover = (
  dom: HTMLElement,
  view: EditorView,
  context: HoverContext
): void => {
  const word = view.state.wordAt(context.pos);
  if (word === null || !/^[A-Za-z_]\w*$/.test(context.word)) {
    return;
  }
  const pinned = pinnedWatches(view.state).find(
    (watch) => watch.name === context.word
  );
  dom.classList.add('plivet-watch');
  dom.classList.toggle('plivet-watch--latched', pinned !== undefined);
  dom.prepend(
    pinButton(
      view,
      pinned ?? { name: context.word, pos: word.from, released: true }
    )
  );
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
        const already = pins.find((watch) => watch.name === wanted.name);
        if (typeof already === 'undefined') {
          pins = pins.concat({ name: wanted.name, pos: wanted.pos });
        } else if (already.released === true) {
          // Asked for again while it lingers: it is pinned again, where it
          // stands.
          pins = pins.map((watch) =>
            watch === already ? { name: watch.name, pos: watch.pos } : watch
          );
        } else {
          pins = pins.filter((watch) => watch !== already);
        }
      }
      if (effect.is(releaseWatch)) {
        const name = effect.value;
        pins = pins.map((watch) =>
          watch.name === name && watch.released !== true
            ? { ...watch, released: true }
            : watch
        );
      }
      if (effect.is(removeWatch)) {
        const name = effect.value;
        if (pins.some((watch) => watch.name === name)) {
          pins = pins.filter((watch) => watch.name !== name);
        }
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
  pinnedWatches(state).map((watch) => watch.name);

/** The watches that are pinned, without the ones let go and still standing. */
export const pinnedWatches = (state: EditorView['state']): Watch[] =>
  (state.field(watchField, false)?.pins ?? []).filter(
    (watch) => watch.released !== true
  );

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
export const watchGesture = (onChange: () => void) => [
  watchChanged.of(onChange),
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
  }),
];
