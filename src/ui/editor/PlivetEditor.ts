import { EditorState, Extension } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
  rectangularSelection,
} from '@codemirror/view';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language';
import { highlightSelectionMatches } from '@codemirror/search';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { autocompletion, CompletionSource } from '@codemirror/autocomplete';
import { cpp, cppLanguage } from '@codemirror/lang-cpp';
import { DebugExtensions, DebugExtensionOptions } from './debugExtensions';
import { excludedRegionFolding } from './folding';
import { unprotected } from './protected';
import strings from '../../strings';
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
  /** The text an empty editor shows. Defaults to the sample's own prompt. */
  placeholder?: string;
  /** `autocomplete`: offer the names the program declares while typing. */
  autocomplete?: boolean;
  /**
   * What to offer. `ProgramCompletions` builds one over the constructs of the
   * last syntax check; a host that has its own completion for C hands its own
   * source in, and leaving it out turns completion off rather than falling
   * back to completing any word in the buffer - a suggestion list built from
   * the reader's own typing offers their misspellings back to them.
   */
  completions?: CompletionSource;
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

/** True only when the C/C++ syntax tree contains a definition of `main`. */
export const containsMainDefinition = (code: string): boolean => {
  let found = false;
  cppLanguage.parser.parse(code).iterate({
    enter(node) {
      if (node.name !== 'FunctionDefinition') {
        return;
      }
      const declarator = node.node.getChild('FunctionDeclarator');
      const identifier = declarator?.getChild('Identifier');
      if (
        identifier !== null &&
        typeof identifier !== 'undefined' &&
        code.slice(identifier.from, identifier.to) === 'main' &&
        node.node.getChild('CompoundStatement') !== null
      ) {
        found = true;
      }
    },
  });
  return found;
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
      // The pieces a CodeMirror editor is usually built with and this one was
      // not. Each is a small thing on its own; together they are the
      // difference between an editor and a textarea with colours.
      drawSelection(),
      dropCursor(),
      rectangularSelection(),
      // A pasted non-breaking space is a mystery that costs a beginner an
      // afternoon. Drawn as a character, it is a typo.
      highlightSpecialChars(),
      // Every other occurrence of the name under the cursor. Reading a loop
      // means finding where its counter is touched, and this answers that
      // without a search.
      highlightSelectionMatches(),
      placeholderExtension(
        typeof options.placeholder === 'undefined'
          ? strings.editorPlaceholder
          : options.placeholder
      ),
      // Function bodies fold because `lang-cpp` marks their blocks; what a
      // conditional directive kept out of the program folds because PLIVET's
      // own preprocessor says which lines those are.
      foldGutter(),
      excludedRegionFolding,
      // Syntax highlighting comes with the theme: which style is readable
      // depends on what colour is behind it. See `ThemeControl`.
      highlightActiveLine(),
      highlightActiveLineGutter(),
      history(),
      // `defaultKeymap` carries `selectParentSyntax` on Mod-i, which is a
      // direct lesson in nesting: press it and the selection grows to the
      // expression, the statement, the block, the function.
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
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
    if (config.autocomplete && typeof options.completions !== 'undefined') {
      const completions = options.completions;
      extensions.push(autocompletion());
      extensions.push(
        EditorState.languageData.of(() => [{ autocomplete: completions }])
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
      // A host handing PLIVET a new program is not a student typing outside
      // the blank, so the protected-region filter lets this one through.
      annotations: unprotected.of(true),
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
