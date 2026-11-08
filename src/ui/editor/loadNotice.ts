import { StateEffect, StateField } from '@codemirror/state';
import { EditorView, Panel, showPanel } from '@codemirror/view';
import strings from '../../strings';

/**
 * The notice a refused replacement leaves over the editor.
 *
 * A file with protected text keeps it: a session, a loaded file or a host's
 * update that would change it is refused, and the editor keeps the text it
 * had. A refusal nobody sees is a load that silently did nothing, so the
 * editor says which line was protected and offers the one way forward that
 * is always safe - putting the default text of that file back.
 *
 * The other shape is a file that opened with protected text already changed,
 * as a submission saved before the lines were protected can be. Its text is
 * held whole until the default is restored, and the notice says that too.
 */

export interface LoadNotice {
  /** The file whose protected text the replacement would have changed. */
  path: string;
  /** The line, from 1, of the replacement where that text stops matching. */
  line: number;
  /** The file on screen is the altered one, and is held until restored. */
  locked: boolean;
}

export const setLoadNotice = StateEffect.define<LoadNotice | null>();

export const loadNoticeField = StateField.define<LoadNotice | null>({
  create: () => null,
  update(notice, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLoadNotice)) {
        notice = effect.value;
      }
    }
    return notice;
  },
});

/** The sentence the notice says, out of the parts the string table holds. */
export const loadNoticeText = (notice: LoadNotice): string =>
  `${strings.loadNoticeLine} ${notice.line} ${strings.loadNoticeOf} ` +
  `${notice.path} ${
    notice.locked ? strings.loadNoticeLocked : strings.loadNoticeRefused
  }`;

const panelFor = (
  view: EditorView,
  notice: LoadNotice,
  onRestoreDefault?: (path: string) => void
): Panel => {
  const dom = document.createElement('div');
  dom.className = 'plivet-load-notice';
  dom.setAttribute('role', 'alert');
  const message = document.createElement('span');
  message.className = 'plivet-load-notice__message';
  message.textContent = loadNoticeText(notice);
  dom.appendChild(message);
  if (typeof onRestoreDefault !== 'undefined') {
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className =
      'plivet-load-notice__button plivet-load-notice__restore';
    restore.textContent = strings.restoreDefault;
    restore.addEventListener('click', () => onRestoreDefault(notice.path));
    dom.appendChild(restore);
  }
  // A locked file stays locked whatever the notice does, so the notice that
  // explains the lock is not one to wave away.
  if (!notice.locked) {
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className =
      'plivet-load-notice__button plivet-load-notice__dismiss';
    dismiss.textContent = strings.dismissNotice;
    dismiss.addEventListener('click', () =>
      view.dispatch({ effects: setLoadNotice.of(null) })
    );
    dom.appendChild(dismiss);
  }
  return { dom, top: true };
};

/** The notice's field and the panel that draws it. */
export const loadNotice = (onRestoreDefault?: (path: string) => void) => [
  loadNoticeField,
  showPanel.from(loadNoticeField, (notice) =>
    notice === null
      ? null
      : (view: EditorView) => panelFor(view, notice, onRestoreDefault)
  ),
];

export const showLoadNotice = (
  view: EditorView,
  notice: LoadNotice | null
): void => {
  view.dispatch({ effects: setLoadNotice.of(notice) });
};

export const loadNoticeOf = (
  view: EditorView | { state: EditorView['state'] }
): LoadNotice | null => view.state.field(loadNoticeField, false) ?? null;
