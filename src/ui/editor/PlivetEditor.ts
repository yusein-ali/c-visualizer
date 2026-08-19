import { EditorState, Extension } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { autocompletion, completeAnyWord } from '@codemirror/autocomplete';
import { cpp } from '@codemirror/lang-cpp';
import { DebugExtensions, DebugExtensionOptions } from './debugExtensions';
import { ThemeControl } from './theme';

/**
 * The editor PLIVET builds when it owns the page.
 *
 * The configuration is assembled the same way, from the same knobs, as
 * `interactive_code_editor.js` assembles one for a C block: the option names
 * below are the `codemirror_config` keys a course sets in `conf.py`, so an
 * embedded PLIVET can be handed the page's own configuration unchanged. The
 * defaults differ in one place - PLIVET's sample programs are indented with
 * two spaces, so that is what it starts with rather than the tabs a course
 * page defaults to.
 *
 * Everything specific to debugging is in `DebugExtensions` and is built
 * separately, because in the embedded case this class does not run at all: the
 * host constructs the view and only the debug array is attached to it.
 */

export interface PlivetEditorOptions extends DebugExtensionOptions {
  /** Initial document. */
  doc?: string;
  /** Called after every edit. Debouncing is the caller's business. */
  onChange?: (code: string) => void;
  dark?: boolean;
  fontSize?: number;
  /** `indent_unit`: columns per indent level. */
  indentUnit?: number;
  /** `indent_with_tabs`: indent with a tab character rather than spaces. */
  indentWithTabs?: boolean;
  /** `electric_chars`: re-indent a line as its syntax becomes clear. */
  electricChars?: boolean;
  /** `match_brackets` */
  matchBrackets?: boolean;
  /** `line_numbers` */
  lineNumbers?: boolean;
  /** `autocomplete`: complete words already present in the document. */
  autocomplete?: boolean;
}

const defaults = {
  indentUnit: 2,
  indentWithTabs: false,
  electricChars: true,
  matchBrackets: true,
  lineNumbers: true,
  autocomplete: true,
  dark: false,
  fontSize: 14,
};

export class PlivetEditor {
  readonly view: EditorView;
  readonly debug: DebugExtensions;

  private readonly theme = new ThemeControl();

  constructor(parent: HTMLElement, options: PlivetEditorOptions = {}) {
    const config = { ...defaults, ...options };
    this.debug = new DebugExtensions(options);

    const extensions: Extension[] = [
      cpp(),
      syntaxHighlighting(defaultHighlightStyle),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      this.theme.extension(config.dark, config.fontSize),
      // Gutters are drawn in the order their extensions appear, so the debug
      // array coming before `lineNumbers()` is what puts the breakpoint column
      // on the outside, where the old Ace gutter had it.
      this.debug.extensions,
    ];

    if (config.lineNumbers) {
      extensions.push(lineNumbers());
    }
    if (config.matchBrackets) {
      extensions.push(bracketMatching());
    }
    if (config.electricChars) {
      extensions.push(indentOnInput());
    }
    if (config.indentWithTabs) {
      extensions.push(indentUnit.of('\t'));
      extensions.push(EditorState.tabSize.of(config.indentUnit));
    } else {
      extensions.push(indentUnit.of(' '.repeat(config.indentUnit)));
    }
    if (config.autocomplete) {
      extensions.push(autocompletion());
      extensions.push(
        EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }])
      );
    }
    if (typeof options.onChange !== 'undefined') {
      const onChange = options.onChange;
      extensions.push(
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChange(update.state.doc.toString());
          }
        })
      );
    }

    this.view = new EditorView({
      doc: typeof options.doc === 'undefined' ? '' : options.doc,
      parent,
      extensions,
    });
  }

  getCode(): string {
    return this.view.state.doc.toString();
  }

  /**
   * Replaces the whole document. Part of the editor's public surface for a
   * host that supplies its own program; a debug session holds the document
   * read-only, so this never happens behind a running program.
   */
  replaceCode(code: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: code },
    });
  }

  setDark(dark: boolean): void {
    this.theme.setDark(this.view, dark);
  }

  setFontSize(fontSize: number): void {
    this.theme.setFontSize(this.view, fontSize);
  }

  destroy(): void {
    this.view.destroy();
  }
}
