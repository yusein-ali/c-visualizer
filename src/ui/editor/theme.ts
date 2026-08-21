import { Compartment, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  defaultHighlightStyle,
  syntaxHighlighting,
} from '@codemirror/language';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

/**
 * Colours are named through CSS custom properties rather than written into the
 * theme, and the fallback chain is deliberate:
 *
 *     --plivet-editor-*  ->  --interactive-editor-*  ->  --bs-*  ->  a literal
 *
 * Standalone, nothing defines any of them and the literals win. Dropped into a
 * course page, the interactive-code stylesheet has already defined the middle
 * pair, so PLIVET's editor matches the interactive-code blocks around it
 * without either side knowing about the other.
 *
 * Only the literal at the end of each chain differs between light and dark.
 * The dark set is what Phase 9's theme switch needed: the two themes were
 * built from one palette, so `dark: true` changed which highlight style
 * CodeMirror thought it was under and nothing else - the editor stayed white
 * behind it. Nobody had seen that, because the button that would have chosen a
 * theme was never rendered.
 */

interface Palette {
  color: string;
  bg: string;
  border: string;
  gutterBg: string;
  gutterColor: string;
  selectionBg: string;
  activeLineBg: string;
}

const lightPalette: Palette = {
  color: '#212529',
  bg: '#ffffff',
  border: '#e3e3e3',
  gutterBg: '#f8f9fa',
  gutterColor: '#6c757d',
  selectionBg: 'rgba(13, 110, 253, 0.25)',
  activeLineBg: 'rgba(0, 0, 0, 0.04)',
};

// The console's dark literals, so the two boxes match when nothing else has an
// opinion about either.
const darkPalette: Palette = {
  color: '#f8f8f2',
  bg: '#272822',
  border: '#3e3d32',
  gutterBg: '#2f3129',
  gutterColor: '#90908a',
  selectionBg: 'rgba(13, 110, 253, 0.45)',
  activeLineBg: 'rgba(255, 255, 255, 0.06)',
};

const colour = (name: string, bootstrap: string, fallback: string) =>
  `var(--plivet-editor-${name}, var(--interactive-editor-${name}, var(--bs-${bootstrap}, ${fallback})))`;

const plain = (name: string, fallback: string) =>
  `var(--plivet-editor-${name}, var(--interactive-editor-${name}, ${fallback}))`;

const chromeFor = (palette: Palette) => ({
  '&': {
    color: colour('color', 'body-color', palette.color),
    backgroundColor: colour('bg', 'body-bg', palette.bg),
    border: `1px solid ${colour('border', 'border-color', palette.border)}`,
  },
  '&.cm-focused': {
    outline: `1px solid ${plain('focus-border', '#86b7fe')}`,
  },
  '.cm-scroller': {
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  },
  '.cm-content': {
    caretColor: colour('caret', 'body-color', palette.color),
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: colour('caret', 'body-color', palette.color),
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: colour('caret', 'body-color', palette.color),
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: plain('selection-bg', palette.selectionBg),
    },
  '.cm-activeLine': {
    backgroundColor: plain('active-line-bg', palette.activeLineBg),
  },
  '.cm-gutters': {
    backgroundColor: colour('gutter-bg', 'tertiary-bg', palette.gutterBg),
    borderRightColor: colour('border', 'border-color', palette.border),
    color: colour('gutter-color', 'secondary-color', palette.gutterColor),
  },
  '.cm-activeLineGutter': {
    backgroundColor: plain('active-line-bg', palette.activeLineBg),
    color: colour('color', 'body-color', palette.color),
  },
  '.cm-matchingBracket': {
    backgroundColor: plain('matching-bg', 'rgba(50, 140, 130, 0.24)'),
    outline: `1px solid ${plain(
      'matching-border',
      'rgba(50, 140, 130, 0.45)'
    )}`,
  },
  '.cm-nonmatchingBracket': {
    backgroundColor: plain('nonmatching-bg', 'rgba(187, 85, 85, 0.24)'),
    outline: `1px solid ${plain(
      'nonmatching-border',
      'rgba(187, 85, 85, 0.45)'
    )}`,
  },
});

/**
 * The frame and the tokens change together: CodeMirror's default highlight
 * style is drawn for a white background, and the purple it gives keywords is
 * unreadable on a dark one.
 */
const light: Extension = [
  EditorView.theme(chromeFor(lightPalette), { dark: false }),
  syntaxHighlighting(defaultHighlightStyle),
];
const dark: Extension = [
  EditorView.theme(chromeFor(darkPalette), { dark: true }),
  syntaxHighlighting(oneDarkHighlightStyle),
];

/**
 * The theme is reconfigured rather than rebuilt, because a course page can
 * switch `data-bs-theme` at any moment and PLIVET's own theme button does the
 * same thing to the same editor.
 */
export class ThemeControl {
  private readonly compartment = new Compartment();
  private readonly fontCompartment = new Compartment();

  extension(isDark: boolean, fontSize: number): Extension {
    return [
      this.compartment.of(isDark ? dark : light),
      this.fontCompartment.of(ThemeControl.fontTheme(fontSize)),
    ];
  }

  setDark(view: EditorView, isDark: boolean): void {
    view.dispatch({
      effects: this.compartment.reconfigure(isDark ? dark : light),
    });
  }

  setFontSize(view: EditorView, fontSize: number): void {
    view.dispatch({
      effects: this.fontCompartment.reconfigure(
        ThemeControl.fontTheme(fontSize)
      ),
    });
  }

  private static fontTheme(fontSize: number) {
    return EditorView.theme({
      '&': { fontSize: `${fontSize}px` },
      '.cm-gutters': { fontSize: `${fontSize}px` },
    });
  }
}

/**
 * Everything the debug extensions draw. This is a base theme rather than a
 * stylesheet so that the extension array carries its own appearance: a host
 * editor gets working breakpoints and highlights by attaching the array, with
 * no CSS file to register alongside it.
 */
export const debugTheme = EditorView.baseTheme({
  '.plivet-breakpoint-gutter': {
    cursor: 'pointer',
  },
  '.plivet-breakpoint-gutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 0.25em',
  },
  '.plivet-breakpoint': {
    display: 'block',
    width: '0.7em',
    height: '0.7em',
    borderRadius: '50%',
    backgroundColor: 'var(--plivet-breakpoint-color, #d90000)',
  },
  // Standalone, these are the rules interactive-code.css applies to a frozen
  // editor; embedded, its stylesheet says the same thing about the same
  // attribute and this simply agrees with it.
  '&[read-only] .cm-scroller': {
    backgroundColor:
      'var(--plivet-editor-readonly-bg, var(--interactive-editor-readonly-bg, var(--bs-secondary-bg, #f0f0f0)))',
  },
  '&dark[read-only] .cm-scroller': {
    backgroundColor:
      'var(--plivet-editor-readonly-bg, var(--interactive-editor-readonly-bg, var(--bs-secondary-bg, rgba(255, 255, 255, 0.06))))',
  },
  '&[read-only] .cm-content': {
    caretColor: 'transparent',
  },
  '.plivet-step-line': {
    backgroundColor: 'var(--plivet-step-line-bg, rgba(255, 214, 0, 0.22))',
  },
  '&dark .plivet-step-line': {
    backgroundColor: 'var(--plivet-step-line-bg, rgba(255, 214, 0, 0.14))',
  },
  '.plivet-step-range': {
    backgroundColor: 'var(--plivet-step-range-bg, rgba(255, 179, 0, 0.45))',
    borderRadius: '2px',
  },
  // The values printed after the current statement. They are an annotation,
  // not program text, so they are set apart from it rather than competing with
  // the syntax colouring beside them.
  '.plivet-inline-values': {
    marginLeft: '2ch',
    padding: '0 0.4em',
    borderRadius: '3px',
    fontStyle: 'italic',
    color: 'var(--plivet-inline-value-color, #5a6b3b)',
    backgroundColor: 'var(--plivet-inline-value-bg, rgba(120, 150, 70, 0.14))',
    // A long line must not be made longer by the annotation on it.
    whiteSpace: 'pre',
  },
  '&dark .plivet-inline-values': {
    color: 'var(--plivet-inline-value-color, #b7c98a)',
    backgroundColor: 'var(--plivet-inline-value-bg, rgba(183, 201, 138, 0.14))',
  },
  '.plivet-error-line': {
    backgroundColor: 'var(--plivet-error-line-bg, #f2dede)',
  },
  '&dark .plivet-error-line': {
    backgroundColor: 'var(--plivet-error-line-bg, rgba(187, 85, 85, 0.28))',
  },
  // The teaching rules' own panel inside a lint tooltip: the finding, then
  // the library entry it points at, set apart from it.
  '.plivet-lint-message': {
    maxWidth: '40em',
    whiteSpace: 'normal',
  },
  '.plivet-lint-signature': {
    display: 'block',
    marginTop: '0.4em',
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  },
  '.plivet-lint-description': {
    opacity: '0.8',
  },
  // The completion side panel: the signature on its own line, in the editor's
  // own monospace, and the sentence under it.
  '.plivet-completion-info': {
    maxWidth: '32em',
    whiteSpace: 'normal',
  },
  '.plivet-completion-info code': {
    display: 'block',
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  },
  '.plivet-completion-info div': {
    marginTop: '0.3em',
    opacity: '0.8',
  },
  '.plivet-macro-expansion': {
    borderBottom: '1px dashed #2e8b57',
    backgroundColor: 'rgba(46, 139, 87, 0.12)',
  },
  '.plivet-excluded-region': {
    backgroundColor: 'rgba(128, 128, 128, 0.18)',
  },
  '.plivet-directive-line': {
    borderBottom: '1px dotted rgba(70, 130, 180, 0.6)',
    backgroundColor: 'rgba(70, 130, 180, 0.1)',
  },
  // The hover tooltip is the only one PLIVET adds, so its wrapper can be
  // styled by the class CodeMirror already puts on hover tooltips; there is no
  // way to name the outer element from inside `create`.
  '.cm-tooltip-hover .plivet-tooltip': {
    maxWidth: '40em',
    padding: '4px 8px',
    fontSize: '12px',
  },
  // The headline: what the reader is pointing at, named. Everything under it
  // is a fact about it, which is what the table is for.
  '.plivet-tooltip__title': {
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
    fontWeight: 'bold',
    marginBottom: '0.25em',
  },
  '.plivet-tooltip__facts': {
    borderCollapse: 'collapse',
  },
  '.plivet-tooltip__facts th': {
    textAlign: 'left',
    fontWeight: 'normal',
    opacity: '0.75',
    paddingRight: '0.8em',
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
  },
  '.plivet-tooltip__facts td': {
    verticalAlign: 'top',
  },
  '.plivet-tooltip__code': {
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  },
  // A sentence about the language rather than a fact about this program: it
  // has no left-hand column to stand in.
  '.plivet-tooltip__note': {
    fontStyle: 'italic',
    opacity: '0.85',
    whiteSpace: 'normal',
  },
  // Where the canvas is pointing. It is deliberately not the step marker's
  // colour: one says where the program is, the other where the reader is.
  '.plivet-focus-line': {
    backgroundColor: 'var(--plivet-focus-line-bg, rgba(217, 164, 0, 0.12))',
  },
  '.plivet-focus-range': {
    backgroundColor: 'var(--plivet-focus-range-bg, rgba(217, 164, 0, 0.3))',
    borderRadius: '2px',
  },
  '.cm-tooltip.cm-tooltip-hover': {
    backgroundColor: 'var(--plivet-tooltip-bg, #fffbe6)',
    color: 'var(--plivet-tooltip-color, #222)',
    border: '1px solid rgba(0, 0, 0, 0.2)',
    borderRadius: '3px',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
  },
  '&dark .cm-tooltip.cm-tooltip-hover': {
    backgroundColor: 'var(--plivet-tooltip-bg, #3e3d32)',
    color: 'var(--plivet-tooltip-color, #f8f8f2)',
    border: '1px solid rgba(255, 255, 255, 0.25)',
  },
});
