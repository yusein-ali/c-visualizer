import type { SourceFile } from '../core';
import {
  anchorSegments,
  segmentsFromLines,
  segmentsFromOffsets,
} from '../ui/editor';
import type { EditableRegion, LineRange, ProtectedSegment } from '../ui/editor';

/**
 * The load policy: the one place that decides whether a text may replace a
 * file's text.
 *
 * Everything that replaces a file wholesale - a host's `updateFiles`, a
 * session restored through the API or from the `session` option, a file
 * loaded with the Load control, a host writing the reader's code back - asks
 * `judgeText` before it changes anything. A file with protected segments
 * keeps them: the replacement is accepted only when every segment is found
 * again, in order, and the editable regions of the new text are the gaps
 * between them. Otherwise it is refused, and the caller keeps the text it had
 * and says which line the replacement would have changed.
 *
 * A file without protected segments accepts anything, which is every file of
 * a program nobody declared regions for.
 */

/**
 * Per-file editable lines with the text they count: the default source of an
 * exercise. Given, the segments are cut from `text` and the file's own text
 * is checked against them; "Restore default" puts `text` back. Left out, the
 * lines count the file's text as the visualizer was handed it.
 */
export interface FileEditableLines {
  lines: LineRange[];
  text?: string;
}

/**
 * `editableRegions` as a page may write it: offsets into the entry file, or
 * 1-based inclusive line ranges per file path, the syntax of the Sphinx
 * `:editable-lines:` option: `{ "main.c": [[7, 12], [20, 20]] }`.
 */
export type EditableRegionsOption =
  | EditableRegion[]
  | Record<string, LineRange[] | FileEditableLines>;

/** One file's protected segments, and where the file stands against them. */
export interface FileProtection {
  segments: ProtectedSegment[];
  /** The text "Restore default" puts back. */
  defaultText: string;
  /** The editable gaps of the file's current text; empty while locked. */
  editable: EditableRegion[];
  /**
   * The file was handed over with protected text already changed - a text
   * that does not match the default its lines count. It is held whole until
   * an intact text replaces it.
   */
  locked: boolean;
  /** Where the held text stops matching, from 1; null while intact. */
  altered: number | null;
}

/** Whether a replacement may stand, and the regions it leaves if it may. */
export type LoadDecision =
  | { accepted: true; editable: EditableRegion[] }
  | { accepted: false; line: number };

/** Where a refused replacement came from, as `onLoadRefused` reports it. */
export type LoadOrigin =
  | 'files'
  | 'session'
  | 'restoreSession'
  | 'updateFiles'
  | 'load';

/** What `onLoadRefused` is told. */
export interface LoadRefusal {
  /** The file whose protected text the replacement would have changed. */
  path: string;
  /** The line, from 1, of the refused text where that text stops matching. */
  line: number;
  /** What tried to replace it. */
  origin: LoadOrigin;
}

/**
 * Whether `text` may replace the text of a file with this protection. No
 * protection accepts anything, with no regions: the whole file is editable.
 */
export const judgeText = (
  protection: FileProtection | undefined,
  text: string
): LoadDecision => {
  if (typeof protection === 'undefined') {
    return { accepted: true, editable: [] };
  }
  const found = anchorSegments(text, protection.segments);
  return found.intact
    ? { accepted: true, editable: found.editable }
    : { accepted: false, line: found.line };
};

/** The protection a file has once `decision` has been applied to it. */
export const accepted = (
  protection: FileProtection,
  editable: EditableRegion[]
): FileProtection => ({
  ...protection,
  editable,
  locked: false,
  altered: null,
});

const IGNORED: Record<string, string> = {
  outside: 'names a line past the end of the file',
  empty: 'names no line',
  everything: 'names every line, so nothing is protected',
};

const warn = (message: string): void => {
  console.warn(`c-visualizer: editableRegions ${message}`);
};

/** A protection out of segments, checked against the file's own text. */
const protectionFor = (
  segments: ProtectedSegment[],
  defaultText: string,
  text: string
): FileProtection => {
  const found = anchorSegments(text, segments);
  return found.intact
    ? {
        segments,
        defaultText,
        editable: found.editable,
        locked: false,
        altered: null,
      }
    : {
        segments,
        defaultText,
        editable: [],
        locked: true,
        altered: found.line,
      };
};

/**
 * Every file's protection at load, keyed by path.
 *
 * The offset array keeps the meaning it always had: spans of the entry
 * file. The per-file form cuts each named file's segments from its lines. A
 * path that is not one of the files, or lines that protect nothing, are
 * dropped with a warning and leave that file editable everywhere - the same
 * rule the Sphinx build applies to an `:editable-lines:` it cannot honour.
 */
export const protectionsFor = (
  files: SourceFile[],
  entry: string,
  option: EditableRegionsOption | undefined
): Map<string, FileProtection> => {
  const protections = new Map<string, FileProtection>();
  if (typeof option === 'undefined') {
    return protections;
  }
  if (Array.isArray(option)) {
    const file = files.find((candidate) => candidate.path === entry);
    const segments =
      typeof file === 'undefined'
        ? null
        : segmentsFromOffsets(file.text, option);
    if (file !== undefined && segments !== null) {
      protections.set(file.path, protectionFor(segments, file.text, file.text));
    }
    return protections;
  }
  for (const [path, value] of Object.entries(option)) {
    const file = files.find((candidate) => candidate.path === path);
    if (typeof file === 'undefined') {
      warn(`names ${path}, which is not one of the files; ignored`);
      continue;
    }
    const lines = Array.isArray(value) ? value : value.lines;
    const defaultText =
      !Array.isArray(value) && typeof value.text === 'string'
        ? value.text
        : file.text;
    const segments = segmentsFromLines(defaultText, lines);
    if (typeof segments === 'string') {
      warn(`of ${path} ${IGNORED[segments]}; every line of it is editable`);
      continue;
    }
    protections.set(path, protectionFor(segments, defaultText, file.text));
  }
  return protections;
};
