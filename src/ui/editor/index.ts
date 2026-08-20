/**
 * PLIVET's editor, and the debugger that attaches to one.
 *
 * Two ways in, and the split between them is the point:
 *
 *   - `PlivetEditor` builds a CodeMirror view and owns it. This is the
 *     standalone application.
 *   - `DebugExtensions` plus `attachDebugExtensions` add breakpoints, the step
 *     highlight, preprocessor marks, diagnostics and hover text to a view
 *     somebody else built - the `InteractiveEditor` of the interactive-code
 *     Sphinx extension, for instance.
 *
 * Nothing under this directory may import from `src/app/`, and the
 * modules that make up the debugger may only import from the five CodeMirror
 * packages the interactive-code page already loads as globals:
 * `@codemirror/state`, `view`, `language`, `commands` and `autocomplete`, plus
 * `@codemirror/lint`, which PLIVET brings itself. `@codemirror/lang-cpp` is
 * imported by `PlivetEditor` alone, because an embedded editor gets its
 * language from the host.
 */
export { PlivetEditor } from './PlivetEditor';
export type { PlivetEditorOptions } from './PlivetEditor';
export { DebugExtensions, attachDebugExtensions } from './debugExtensions';
export type { DebugExtensionOptions } from './debugExtensions';
export { breakpointRows } from './breakpoints';
export { diagnosticsFor, teachingDiagnosticsFor } from './diagnostics';
export type { SyntaxError, TeachingDiagnostic } from './diagnostics';
export { expansionAt } from './expansions';
export { inlineValueField } from './inlineValues';
export { setStepHighlight, showStep } from './stepHighlight';
export type { InlineValue, StepMark } from './stepHighlight';
export { offsetAt, rangeOf, rowAt, rowRange, startOfRow } from './positions';
export type { SourceRange } from './positions';
export type { HoverContext, HoverText } from './tooltip';
