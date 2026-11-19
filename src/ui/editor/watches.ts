import { Facet, MapMode, StateEffect, StateField } from '@codemirror/state';
import {
  closeHoverTooltips,
  EditorView,
  showTooltip,
  Tooltip,
} from '@codemirror/view';
import { HoverContext, HoverRecord, hoverDom } from './tooltip';
import strings from '../../strings';
import { iconFor } from '../controls/icons';

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
 *
 * A watch is folded to one line, its name and its value, because several of
 * them stand over the text at once and a table each would bury the program
 * they are about. The triangle before the name unfolds it to everything the
 * hover says - the type, what it points at, the address - and folds it again.
 *
 * A watch stands over its name at first, and it can be dragged by that line
 * to wherever it is out of the way: after it is let go it keeps its distance
 * from the name, so it scrolls with the line it belongs to. A moved watch
 * loses the arrow, which would point at nothing; the name it starts with says
 * whose value it is. A double-click on the line puts it back. Folding and
 * moving belong to the watch, not to its tooltip, which is built again at
 * every step.
 */

/** How far a watch has been dragged from its place over the name, in pixels. */
export interface WatchOffset {
  x: number;
  y: number;
}

/** A pinned name and where it was pinned, so the tooltip stays with it. */
export interface Watch {
  name: string;
  pos: number;
  /**
   * Let go by its pin, and standing only until the pointer leaves it. It is
   * no longer a watch for anything that asks which names are pinned.
   */
  released?: boolean;
  /** Unfolded to every fact rather than the value alone. */
  expanded?: boolean;
  /** Dragged away from its name; absent while it stands over it. */
  offset?: WatchOffset;
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

/** Unfold a watch to every fact, or fold it back to its value. */
export const expandWatch = StateEffect.define<{
  name: string;
  expanded: boolean;
}>();

/** Move a watch by hand, or put it back over its name with `null`. */
export const moveWatch = StateEffect.define<{
  name: string;
  offset: WatchOffset | null;
}>();

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
      const dom = watchDom(view, watch, record);
      const released = watch.released === true;
      dom.classList.add('plivet-watch');
      dom.classList.toggle('plivet-watch--latched', !released);
      dom.prepend(pinButton(view, watch));
      place(dom, watch.offset);
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

/** Whether a fact says anything; an empty one gets no line. */
const says = (fact: HoverRecord['facts'][number]): boolean =>
  fact.label !== '' || fact.value !== '';

/**
 * A watch's face. Folded, it is one line: the name and its brief fact, the
 * value. Unfolded, it is the hover's table. Either way the line with the name
 * is the handle it is dragged by, and the triangle on it - where there is
 * more than the brief fact to show - folds and unfolds it.
 */
const watchDom = (
  view: EditorView,
  watch: Watch,
  record: HoverRecord
): HTMLElement => {
  const said = record.facts.filter(says);
  // The fact marked brief - a variable's value - or, in a record that marks
  // none, the first thing it says.
  const marked = said.filter((fact) => fact.brief === true);
  const brief = marked.length > 0 ? marked : said.slice(0, 1);
  const more = said.some((fact) => !brief.includes(fact));
  const expanded = more && watch.expanded === true;
  const dom = hoverDom(expanded ? record : { title: record.title, facts: [] });
  dom.classList.toggle('plivet-watch--folded', !expanded);
  const title = dom.querySelector<HTMLElement>('.plivet-tooltip__title');
  if (title === null) {
    return dom;
  }
  title.textContent = '';
  title.classList.add('plivet-watch__handle');
  if (more) {
    title.appendChild(detailsButton(view, watch));
  }
  const name = document.createElement('span');
  name.className = 'plivet-watch__name';
  name.textContent = record.title;
  title.appendChild(name);
  if (!expanded) {
    for (const fact of brief) {
      const shown = document.createElement('span');
      if (fact.label !== '' && fact.value !== '') {
        shown.className = 'plivet-watch__value';
        if (fact.code === true) {
          shown.classList.add('plivet-tooltip__code');
        }
        shown.textContent = `= ${fact.value}`;
      } else {
        shown.className = 'plivet-watch__brief';
        shown.textContent = fact.label === '' ? fact.value : fact.label;
      }
      title.appendChild(shown);
    }
  }
  draggable(view, watch, dom, title);
  return dom;
};

/** Where a watch stands: over its name, or moved by hand from there. */
const place = (dom: HTMLElement, offset: WatchOffset | undefined): void => {
  const moved =
    typeof offset !== 'undefined' && (offset.x !== 0 || offset.y !== 0);
  dom.style.transform = moved ? `translate(${offset.x}px, ${offset.y}px)` : '';
  dom.classList.toggle('plivet-watch--moved', moved);
};

/**
 * A press on a control of a watch must not take the focus out of the editor,
 * nor reach it as a click on the text under the tooltip.
 */
const keepFocus = (element: HTMLElement): void => {
  element.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
};

/** The triangle that folds a watch to its value and unfolds it again. */
const detailsButton = (view: EditorView, watch: Watch): HTMLButtonElement => {
  const expanded = watch.expanded === true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'plivet-watch__toggle';
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  const label = (
    expanded ? strings.watchCollapse : strings.watchExpand
  ).replace('{name}', watch.name);
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(iconFor('disclose'));
  keepFocus(button);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    view.dispatch({
      effects: expandWatch.of({ name: watch.name, expanded: !expanded }),
    });
  });
  return button;
};

/** The two presses of a double-click, at most this far apart. */
const DOUBLE_PRESS_MS = 400;

/**
 * A drag is kept inside the editor, but a watch that already stands partly
 * outside it - CodeMirror places a wide one against the window, not the
 * editor - is only stopped from going further out, never pulled back the
 * other way by the first move.
 */
const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, Math.min(low, 0)), Math.max(high, 0));

/**
 * Dragging a watch by its line. The tooltip is moved with a transform while
 * the pointer is down, and only the place it is let go at is written into the
 * state: the tooltip is built again whenever the state changes, and a drag
 * that wrote every step of the way would be dropped by its own rebuild. The
 * watch is kept inside the editor, so it cannot be dragged out of reach.
 */
const draggable = (
  view: EditorView,
  watch: Watch,
  dom: HTMLElement,
  handle: HTMLElement
): void => {
  handle.title = strings.watchMove.replace('{name}', watch.name);
  let lastPress = -Infinity;
  handle.addEventListener('mousedown', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });
  handle.addEventListener('pointerdown', (event) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button'))
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // A double-click puts the watch back over its name. The pointer events
    // are taken here, so the browser's own dblclick cannot be relied on.
    const now = event.timeStamp;
    if (now - lastPress < DOUBLE_PRESS_MS) {
      lastPress = -Infinity;
      if (typeof watch.offset !== 'undefined') {
        view.dispatch({
          effects: moveWatch.of({ name: watch.name, offset: null }),
        });
      }
      return;
    }
    lastPress = now;
    const from = watch.offset ?? { x: 0, y: 0 };
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = view.dom.getBoundingClientRect();
    const box = dom.getBoundingClientRect();
    let offset = from;
    dom.classList.add('plivet-watch--dragging');
    if (typeof handle.setPointerCapture === 'function') {
      handle.setPointerCapture(event.pointerId);
    }
    const move = (moved: PointerEvent) => {
      const dx = clamp(
        moved.clientX - startX,
        bounds.left - box.left,
        bounds.right - box.right
      );
      const dy = clamp(
        moved.clientY - startY,
        bounds.top - box.top,
        bounds.bottom - box.bottom
      );
      offset = { x: Math.round(from.x + dx), y: Math.round(from.y + dy) };
      place(dom, offset);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      dom.classList.remove('plivet-watch--dragging');
      if (offset.x !== from.x || offset.y !== from.y) {
        // A real drag is not the first half of a double-click.
        lastPress = -Infinity;
        view.dispatch({
          effects: moveWatch.of({ name: watch.name, offset }),
        });
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
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
  button.appendChild(iconFor('pin'));
  keepFocus(button);
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

/** A watch as pinned: what the reader set on it kept, `released` dropped. */
const latched = (watch: Watch): Watch => {
  const kept: Watch = { name: watch.name, pos: watch.pos };
  if (watch.expanded === true) {
    kept.expanded = true;
  }
  if (typeof watch.offset !== 'undefined') {
    kept.offset = watch.offset;
  }
  return kept;
};

/** The pins with one watch changed, or the same array if it is not there. */
const changeWatch = (
  pins: Watch[],
  name: string,
  change: (watch: Watch) => Watch
): Watch[] =>
  pins.some((watch) => watch.name === name)
    ? pins.map((watch) => (watch.name === name ? change(watch) : watch))
    : pins;

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
          pins = pins.concat(latched(wanted));
        } else if (already.released === true) {
          // Asked for again while it lingers: it is pinned again, where it
          // stands, folded or unfolded as it was.
          pins = pins.map((watch) =>
            watch === already ? latched(watch) : watch
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
      if (effect.is(expandWatch)) {
        const { name, expanded } = effect.value;
        pins = changeWatch(pins, name, (watch) => {
          const next: Watch = { ...watch };
          if (expanded) {
            next.expanded = true;
          } else {
            delete next.expanded;
          }
          return next;
        });
      }
      if (effect.is(moveWatch)) {
        const { name, offset } = effect.value;
        pins = changeWatch(pins, name, (watch) => {
          const next: Watch = { ...watch };
          if (offset === null || (offset.x === 0 && offset.y === 0)) {
            delete next.offset;
          } else {
            next.offset = { x: offset.x, y: offset.y };
          }
          return next;
        });
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
