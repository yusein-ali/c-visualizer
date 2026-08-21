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
import { lintGutter } from '@codemirror/lint';
import {
  SyntaxError,
  TeachingDiagnostic,
  errorLineField,
  showDiagnostics as markDiagnostics,
} from './diagnostics';
import { expansionField, showExpansions as markExpansions } from './expansions';
import { focusField, showFocus as markFocus } from './focus';
import { inlineValueField } from './inlineValues';
import {
  showStep as markStep,
  StepMark,
  stepHighlightField,
} from './stepHighlight';
import { debugTheme } from './theme';
import { HoverText, plivetHoverTooltip } from './tooltip';
import { SourceRange } from './positions';

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
  /**
   * The object the open tooltip is describing, and null when it closes. It is
   * what the canvas lights a row up from; the editor knows nothing about who
   * is listening.
   */
  onHoverObject?: (object: string | null) => void;
}

export class DebugExtensions {
  private readonly readOnly = new Compartment();

  readonly extensions: Extension[];

  constructor(options: DebugExtensionOptions = {}) {
    this.extensions = [
      debugTheme,
      breakpointGutter,
      stepHighlightField,
      inlineValueField,
      expansionField,
      errorLineField,
      focusField,
      // The gutter is what makes a warning visible without hovering for one.
      // A reader who does not know a rule exists never hovers to find out.
      lintGutter(),
      this.readOnly.of(DebugExtensions.readOnlyExtension(false)),
    ];
    if (typeof options.hoverText !== 'undefined') {
      this.extensions.push(
        plivetHoverTooltip({
          text: options.hoverText,
          onFocus: options.onHoverObject,
        })
      );
    }
  }

  /** Breakpoints as zero-based rows, which is how the interpreter wants them. */
  rows(state: EditorState): number[] {
    return breakpointRows(state);
  }

  setBreakpoints(view: EditorView, rows: number[]): void {
    applyBreakpoints(view, rows);
  }

  /**
   * Where execution stands, and what that statement's variables hold. Both
   * arrive together because they are one fact about one step.
   */
  showStep(view: EditorView, mark: StepMark | null, scroll = true): void {
    markStep(view, mark, scroll);
  }

  /**
   * Marks the declaration of the object the reader is pointing at on the
   * canvas, or takes the mark off with null.
   */
  showFocus(view: EditorView, range: SourceRange | null): void {
    markFocus(view, range);
  }

  showExpansions(view: EditorView, expansions: Expansion[]): void {
    markExpansions(view, expansions);
  }

  showDiagnostics(
    view: EditorView,
    errors: SyntaxError[],
    found: TeachingDiagnostic[] = []
  ): void {
    markDiagnostics(view, errors, found);
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
