import type { SourceFile } from '../core';

/**
 * One immutable view of the program a host can compile, save or submit.
 *
 * `revision` changes whenever a file, the entry file or the set of open files
 * changes. A remote compiler can return it with its answer so a slow result is
 * never painted over newer source.
 */
export interface SourceSnapshot {
  files: SourceFile[];
  entry: string;
  active: string;
  revision: number;
}

/** A zero-based position in one source file; `to` positions are exclusive. */
export interface SourcePosition {
  line: number;
  column: number;
}

/**
 * A compiler finding after the host has translated its service's JSON.
 *
 * This deliberately does not expose GCC's wire format. A+ owns that endpoint
 * and maps any temporary compiler path back to the `SourceFile.path` it sent;
 * PLIVET only needs the stable fact that can be drawn in an editor.
 */
export interface ExternalDiagnostic {
  path: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** The compiler option or diagnostic id, for example `-Wunused-variable`. */
  code?: string;
  from: SourcePosition;
  to: SourcePosition;
}

/** Correlates a remote answer with the source it compiled. */
export interface DiagnosticOptions {
  revision?: number;
}

/** A host service that compiles one complete source snapshot. */
export type DiagnosticProvider = (
  snapshot: SourceSnapshot
) => ExternalDiagnostic[] | Promise<ExternalDiagnostic[]>;

/** Stops a callback registered on one visualizer instance. */
export type Unsubscribe = () => void;

/**
 * The CodeMirror settings a host page has already chosen for its own editors.
 *
 * A course page holds a block's editors and the window this opens beside each
 * other, and a reader moves between them mid-exercise: the same program, the
 * same tab strip, one of them indenting with tabs and the other with two
 * spaces. The page already answers that question for its own editors, in
 * `conf.py`, and this is how that answer reaches the one PLIVET builds.
 *
 * Both spellings of every field are read: the `codemirror_config` keys as a
 * course writes them, and the camelCase names `PlivetEditorOptions` takes, so
 * a host hands over what it has rather than translating it first. A key that
 * is neither - the `replace_all_code_blocks` of the page's own directive, the
 * `language_configs` a host resolved before handing this over - is ignored in
 * silence: this is a page's whole configuration, and most of it was never
 * about this editor.
 */
export interface CodeMirrorConfig {
  /** Columns per indent level. */
  indentUnit?: number;
  indent_unit?: number;
  /** Indent with a tab character rather than spaces. */
  indentWithTabs?: boolean;
  indent_with_tabs?: boolean;
  /** Re-indent a line as its syntax becomes clear. */
  electricChars?: boolean;
  electric_chars?: boolean;
  /** Mark the bracket matching the one at the cursor. */
  matchBrackets?: boolean;
  match_brackets?: boolean;
  /** Draw the line-number gutter. */
  lineNumbers?: boolean;
  line_numbers?: boolean;
  /** Offer the names the program declares while typing. */
  autocomplete?: boolean;
  /** The text size the editor opens at, in pixels. */
  fontSize?: number;
  font_size?: number;
  /** Whatever else the page's configuration carries, which is not read here. */
  [setting: string]: unknown;
}

/** The same settings under the names the editor itself takes. */
export interface CodeMirrorSettings {
  indentUnit?: number;
  indentWithTabs?: boolean;
  electricChars?: boolean;
  matchBrackets?: boolean;
  lineNumbers?: boolean;
  autocomplete?: boolean;
  fontSize?: number;
}

/**
 * A setting written as text, read as what it says.
 *
 * A configuration is a page's, and a page assembles one out of what its own
 * generator had: the Sphinx extension fills the settings a course left out
 * with `"true"` and `"4"`, because that is what its editors have always been
 * handed. `"false"` is a true string and would switch a setting on, so the two
 * words are read here rather than tested for truth.
 */
export const codeMirrorFlag = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return undefined;
};

/** A count of columns or pixels, likewise, and never zero or a fraction. */
export const codeMirrorCount = (value: unknown): number | undefined => {
  const count = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    return undefined;
  }
  return count;
};

/**
 * What the editor is built with, out of what the host wrote.
 *
 * A field the host did not name, or named as something it cannot be, is left
 * out rather than defaulted here: what "not configured" means stays
 * `PlivetEditor`'s answer, which is the same rule the rest of the
 * configuration follows.
 */
export const codeMirrorSettings = (
  config: CodeMirrorConfig = {}
): CodeMirrorSettings => {
  const settings: CodeMirrorSettings = {};
  const indentUnit = codeMirrorCount(config.indentUnit ?? config.indent_unit);
  const fontSize = codeMirrorCount(config.fontSize ?? config.font_size);
  const flags = {
    indentWithTabs: config.indentWithTabs ?? config.indent_with_tabs,
    electricChars: config.electricChars ?? config.electric_chars,
    matchBrackets: config.matchBrackets ?? config.match_brackets,
    lineNumbers: config.lineNumbers ?? config.line_numbers,
    autocomplete: config.autocomplete,
  };
  if (typeof indentUnit !== 'undefined') {
    settings.indentUnit = indentUnit;
  }
  if (typeof fontSize !== 'undefined') {
    settings.fontSize = fontSize;
  }
  for (const [name, written] of Object.entries(flags)) {
    const flag = codeMirrorFlag(written);
    if (typeof flag !== 'undefined') {
      settings[name as keyof typeof flags] = flag;
    }
  }
  return settings;
};
