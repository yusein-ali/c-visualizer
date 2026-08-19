import {
  Compartment,
  EditorState,
  Extension,
  StateEffect,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Expansion } from '../../interpreter/Expansion';
import {
  applyBreakpoints,
  breakpointGutter,
  breakpointRows,
} from './breakpoints';
import {
  SyntaxError,
  errorLineField,
  showDiagnostics as markDiagnostics,
} from './diagnostics';
import { expansionField, showExpansions as markExpansions } from './expansions';
import { SourceRange } from './positions';
import { showStep as markStep, stepHighlightField } from './stepHighlight';
import { debugTheme } from './theme';
import { HoverText, plivetHoverTooltip } from './tooltip';

/**
 * PLIVET's debugger, as an extension array and a handle to drive it.
 *
 * This is the whole of what attaches to an editor. Standalone, `PlivetEditor`
 * builds a view and includes the array; embedded, the host's
 * `InteractiveEditor` has already built one and the same array is appended to
 * its configuration. Nothing in here constructs a view, chooses a language, or
 * assumes it owns the document - those belong to whoever made the editor.
 */

export interface DebugExtensionOptions {
  /** What to say about the position under the pointer. */
  hoverText?: HoverText;
}

export class DebugExtensions {
  private readonly readOnly = new Compartment();

  readonly extensions: Extension[];

  constructor(options: DebugExtensionOptions = {}) {
    this.extensions = [
      debugTheme,
      breakpointGutter,
      stepHighlightField,
      expansionField,
      errorLineField,
      this.readOnly.of(DebugExtensions.readOnlyExtension(false)),
    ];
    if (typeof options.hoverText !== 'undefined') {
      this.extensions.push(plivetHoverTooltip(options.hoverText));
    }
  }

  /** Breakpoints as zero-based rows, which is how the interpreter wants them. */
  rows(state: EditorState): number[] {
    return breakpointRows(state);
  }

  setBreakpoints(view: EditorView, rows: number[]): void {
    applyBreakpoints(view, rows);
  }

  showStep(view: EditorView, range: SourceRange | null, scroll = true): void {
    markStep(view, range, scroll);
  }

  showExpansions(view: EditorView, expansions: Expansion[]): void {
    markExpansions(view, expansions);
  }

  showDiagnostics(view: EditorView, errors: SyntaxError[]): void {
    markDiagnostics(view, errors);
  }

  /**
   * A live debug session freezes the document. The old editor let the source
   * drift away from the running program and then argued with the user about it
   * in a modal; making the document read-only removes the argument, and it is
   * what the host editor already does through `forceReadOnly()`.
   */
  setReadOnly(view: EditorView, readOnly: boolean): void {
    view.dispatch({
      effects: this.readOnly.reconfigure(
        DebugExtensions.readOnlyExtension(readOnly)
      ),
    });
  }

  /**
   * Read-only is two things, and the second one matters for a course page.
   * `EditorState.readOnly` stops the edit; the `read-only` attribute is the
   * hook interactive-code's stylesheet already styles - the same attribute
   * `InteractiveEditor.forceReadOnly()` sets - so an embedded PLIVET looks
   * frozen the way every other frozen editor on the page does.
   */
  private static readOnlyExtension(readOnly: boolean): Extension {
    return readOnly
      ? [
          EditorState.readOnly.of(true),
          EditorView.editorAttributes.of({ 'read-only': 'true' }),
        ]
      : EditorState.readOnly.of(false);
  }
}

/**
 * Adds the debugger to an editor that already exists - the embedded case,
 * where the view belongs to the host page.
 */
export const attachDebugExtensions = (
  view: EditorView,
  debug: DebugExtensions
): void => {
  view.dispatch({ effects: StateEffect.appendConfig.of(debug.extensions) });
};
