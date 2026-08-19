import { Compartment, Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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
 */

const colour = (name: string, bootstrap: string, fallback: string) =>
  `var(--plivet-editor-${name}, var(--interactive-editor-${name}, var(--bs-${bootstrap}, ${fallback})))`;

const plain = (name: string, fallback: string) =>
  `var(--plivet-editor-${name}, var(--interactive-editor-${name}, ${fallback}))`;

const chrome = {
  '&': {
    color: colour('color', 'body-color', '#212529'),
    backgroundColor: colour('bg', 'body-bg', '#ffffff'),
    border: `1px solid ${colour('border', 'border-color', '#e3e3e3')}`,
  },
  '&.cm-focused': {
    outline: `1px solid ${plain('focus-border', '#86b7fe')}`,
  },
  '.cm-scroller': {
    fontFamily:
      'var(--plivet-editor-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)',
  },
  '.cm-content': {
    caretColor: colour('caret', 'body-color', '#212529'),
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: colour('caret', 'body-color', '#212529'),
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: colour('caret', 'body-color', '#212529'),
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: plain('selection-bg', 'rgba(13, 110, 253, 0.25)'),
    },
  '.cm-activeLine': {
    backgroundColor: plain('active-line-bg', 'rgba(0, 0, 0, 0.04)'),
  },
  '.cm-gutters': {
    backgroundColor: colour('gutter-bg', 'tertiary-bg', '#f8f9fa'),
    borderRightColor: colour('border', 'border-color', '#e3e3e3'),
    color: colour('gutter-color', 'secondary-color', '#6c757d'),
  },
  '.cm-activeLineGutter': {
    backgroundColor: plain('active-line-bg', 'rgba(0, 0, 0, 0.04)'),
    color: colour('color', 'body-color', '#212529'),
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
};

const light = EditorView.theme(chrome, { dark: false });
const dark = EditorView.theme(chrome, { dark: true });

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
  '.plivet-error-line': {
    backgroundColor: 'var(--plivet-error-line-bg, #f2dede)',
  },
  '&dark .plivet-error-line': {
    backgroundColor: 'var(--plivet-error-line-bg, rgba(187, 85, 85, 0.28))',
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
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
  },
  '.cm-tooltip.cm-tooltip-hover': {
    backgroundColor: 'var(--plivet-tooltip-bg, #fffbe6)',
    color: 'var(--plivet-tooltip-color, #222)',
    border: '1px solid rgba(0, 0, 0, 0.2)',
    borderRadius: '3px',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.25)',
  },
});
