import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MergeView } from '@codemirror/merge';
import { cpp } from '@codemirror/lang-cpp';
import strings from '../../strings';
import './preprocessed.css';

/**
 * What the preprocessor did, side by side with what the reader wrote.
 *
 * `#define` and `#include` are the one part of C that changes the program
 * before the compiler sees it, and a beginner debugging a macro is debugging
 * text they cannot see. The editor already marks each replacement and says
 * what it became on hover, one at a time; this is the whole file at once, with
 * the differences aligned, which is the only way to read what a conditional
 * kept out - an absence has nothing to hover.
 *
 * It is a second editor rather than an extension, so it is deliberately not
 * part of the debug array and does not travel to a host page. `@codemirror/merge`
 * is loaded for this and nothing else.
 */

export interface PreprocessedDialogOptions {
  dark?: boolean;
}

export class PreprocessedDialog {
  readonly root: HTMLDialogElement;

  private readonly body: HTMLDivElement;
  private merge: MergeView | null = null;

  constructor(parent: HTMLElement, options: PreprocessedDialogOptions = {}) {
    this.root = document.createElement('dialog');
    this.root.className = 'plivet-preprocessed';
    if (options.dark === true) {
      this.root.classList.add('plivet-preprocessed--dark');
    }

    const title = document.createElement('h2');
    title.className = 'plivet-preprocessed__title';
    title.textContent = strings.preprocessedTitle;

    const hint = document.createElement('p');
    hint.className = 'plivet-preprocessed__hint';
    hint.textContent = strings.preprocessedHint;

    this.body = document.createElement('div');
    this.body.className = 'plivet-preprocessed__body';

    const footer = document.createElement('div');
    footer.className = 'plivet-preprocessed__footer';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'plivet-preprocessed__close';
    close.textContent = strings.close;
    close.addEventListener('click', () => this.close());
    footer.appendChild(close);

    this.root.append(title, hint, this.body, footer);
    parent.appendChild(this.root);
  }

  /**
   * Shows one pair. The view is built per opening rather than kept and
   * updated: the source changes while the dialog is closed, and a merge view
   * holding a stale half of the comparison is worse than none.
   */
  open(source: string, preprocessed: string): void {
    this.replaceMerge(source, preprocessed);
    if (typeof this.root.showModal === 'function') {
      this.root.showModal();
      return;
    }
    this.root.setAttribute('open', '');
  }

  close(): void {
    if (typeof this.root.close === 'function') {
      this.root.close();
    } else {
      this.root.removeAttribute('open');
    }
    this.disposeMerge();
  }

  setDark(dark: boolean): void {
    this.root.classList.toggle('plivet-preprocessed--dark', dark);
  }

  destroy(): void {
    this.disposeMerge();
    this.root.remove();
  }

  private replaceMerge(source: string, preprocessed: string): void {
    this.disposeMerge();
    // Both halves are read-only. Neither is the document the reader is
    // editing: the left is a copy of it and the right is the compiler's own
    // input, which nobody types.
    // A `MergeView` builds its own two views from state configuration, so
    // read-only has to be in the extensions it is given rather than in a
    // state made here.
    const half = (doc: string) => ({
      doc,
      extensions: [
        cpp(),
        lineNumbers(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
      ],
    });
    this.merge = new MergeView({
      a: half(source),
      b: half(preprocessed),
      parent: this.body,
      // Nothing is being merged: the two halves are one text before and after
      // a pass over it, so there is nothing to move from one to the other.
      revertControls: undefined,
      highlightChanges: true,
      gutter: true,
    });
  }

  private disposeMerge(): void {
    if (this.merge !== null) {
      this.merge.destroy();
      this.merge = null;
    }
    this.body.replaceChildren();
  }
}
