import type { EditableRegion } from './protected';

/**
 * Protected segments: the text of an exercise the reader may not change, as
 * text rather than as positions.
 *
 * Offsets describe one version of a file. The moment the whole file is
 * replaced - a host writing the reader's code back, a session restored, a
 * file loaded over the tab - they describe nothing, which is how a full
 * replacement used to lose the editable regions altogether. A segment is
 * found again in the new text by its exact text, in order, and the editable
 * regions are the gaps between the segments found. A replacement in which a
 * segment cannot be found has changed protected text.
 *
 * The rules are the ones the interactive-code Sphinx editor applies to a
 * source with `:editable-lines:`, so that the editor of a course block and
 * the visualizer opened from it accept and refuse the same text:
 *
 *   - The text of a segment cut by line runs from the line break before its
 *     first line (or the start of the file) to the line break after its last
 *     line (or the end of the file). A protected line then stays a line of
 *     its own, and an editable range the reader empties is still a line to
 *     type in.
 *   - A segment that opens the file must open the text, one that closes the
 *     file must close it, and every other one is the first occurrence after
 *     the segment before it.
 *
 * Nothing in here touches CodeMirror: it is text in and positions out.
 */

/** A 1-based, inclusive range of lines: the syntax of `:editable-lines:`. */
export type LineRange = [number, number];

/** One protected span of a file, as cut from the text it was declared on. */
export interface ProtectedSegment {
  /** Exactly the text that must be found again. */
  text: string;
  /** First and last line of the span, from 1, in the text it was cut from. */
  startLine: number;
  endLine: number;
  /** The span begins the file, so it is looked for at offset 0 only. */
  opensFile: boolean;
  /** The span ends the file, so it is looked for at the end only. */
  closesFile: boolean;
}

/** Where one segment was found: offsets, `to` exclusive. */
export interface SegmentAnchor {
  from: number;
  to: number;
}

/** A protected span located in the current text, as a host receives it. */
export interface ProtectedSpan {
  text: string;
  /** Offsets into the current text, `to` exclusive; -1 when not found. */
  from: number;
  to: number;
}

/**
 * What locating the segments in a text found: the segments and the gaps
 * between them, or the first segment missing and the line where the text
 * stops matching it.
 */
export type Anchoring =
  | { intact: true; anchors: SegmentAnchor[]; editable: EditableRegion[] }
  | { intact: false; failed: number; line: number };

/** Why a set of line ranges protects nothing. */
export type IgnoredLines = 'outside' | 'empty' | 'everything';

/**
 * The number of lines of a text as an author counts them. A text that ends
 * with a line break shows one more, empty, line in the editor, and that line
 * is not one an author numbers.
 */
export const sourceLineCount = (text: string): number => {
  if (text === '') {
    return 0;
  }
  const count = text.split('\n').length;
  return text.endsWith('\n') ? count - 1 : count;
};

const isLineNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** Whether a value is one well-formed line range. */
export const isLineRange = (value: unknown): value is LineRange =>
  Array.isArray(value) &&
  value.length === 2 &&
  isLineNumber(value[0]) &&
  isLineNumber(value[1]) &&
  value[0] <= value[1];

/** The ranges sorted, with overlapping and adjacent ones merged. */
export const mergeLineRanges = (ranges: LineRange[]): LineRange[] => {
  const merged: LineRange[] = [];
  for (const [start, end] of [...ranges].sort(
    (left, right) => left[0] - right[0] || left[1] - right[1]
  )) {
    const last = merged[merged.length - 1];
    if (typeof last !== 'undefined' && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
};

/**
 * The protected segments of a text around editable line ranges, or why there
 * are none. Mirrors `protected_segments` of the Sphinx extension's
 * `interactive_code_editable.py`: a range past the last line drops the whole
 * declaration rather than part of it, and so does one that leaves nothing
 * editable or nothing protected.
 */
export const segmentsFromLines = (
  text: string,
  ranges: LineRange[]
): ProtectedSegment[] | IgnoredLines => {
  const lineCount = sourceLineCount(text);
  const valid = ranges.filter(isLineRange);
  if (valid.some(([, end]) => end > lineCount)) {
    return 'outside';
  }
  const editable = mergeLineRanges(valid);
  if (editable.length === 0) {
    return 'empty';
  }
  const protectedLines: LineRange[] = [];
  let next = 1;
  for (const [start, end] of editable) {
    if (start > next) {
      protectedLines.push([next, start - 1]);
    }
    next = end + 1;
  }
  if (next <= lineCount) {
    protectedLines.push([next, lineCount]);
  }
  if (protectedLines.length === 0) {
    return 'everything';
  }
  // Where every line starts and ends, the end before its line break.
  const lines: { from: number; to: number }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    lines.push({ from: offset, to: offset + line.length });
    offset += line.length + 1;
  }
  return protectedLines.map(([start, end]) => {
    const from = start === 1 ? 0 : lines[start - 2].to;
    const to = end === lineCount ? text.length : lines[end - 1].to + 1;
    return {
      text: text.slice(from, to),
      startLine: start,
      endLine: end,
      opensFile: start === 1,
      closesFile: end === lineCount,
    };
  });
};

/** The line, from 1, that an offset falls on. */
const lineOf = (text: string, offset: number): number => {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), text.length);
  for (let index = 0; index < end; index++) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
};

/**
 * Editable offset regions sorted, clamped onto the text, and merged where
 * they overlap or touch. A region whose ends are the wrong way round is
 * dropped: it says nothing a reader could type into.
 */
export const normalizeRegions = (
  text: string,
  regions: EditableRegion[]
): EditableRegion[] => {
  const clamp = (offset: number) =>
    Math.min(Math.max(Math.trunc(offset), 0), text.length);
  const merged: EditableRegion[] = [];
  for (const region of regions
    .filter(
      (region) =>
        Number.isFinite(region.from) &&
        Number.isFinite(region.to) &&
        region.from <= region.to
    )
    .map((region) => ({ from: clamp(region.from), to: clamp(region.to) }))
    .sort((left, right) => left.from - right.from || left.to - right.to)) {
    const last = merged[merged.length - 1];
    if (typeof last !== 'undefined' && region.from <= last.to) {
      last.to = Math.max(last.to, region.to);
    } else {
      merged.push({ ...region });
    }
  }
  return merged;
};

/**
 * The protected segments of a text around editable offset regions: the text
 * between them. Null when the regions leave nothing protected, or are none at
 * all - an empty list has always meant a file editable everywhere.
 */
export const segmentsFromOffsets = (
  text: string,
  regions: EditableRegion[]
): ProtectedSegment[] | null => {
  const editable = normalizeRegions(text, regions);
  if (editable.length === 0) {
    return null;
  }
  // Whether a span opens or closes the file is whether a region lies before
  // or after it, not where it starts: an empty region at offset 0 is a place
  // to type in front of the first span.
  const spans: { from: number; to: number; opens: boolean; closes: boolean }[] =
    [];
  if (editable[0].from > 0) {
    spans.push({ from: 0, to: editable[0].from, opens: true, closes: false });
  }
  for (let index = 0; index + 1 < editable.length; index++) {
    spans.push({
      from: editable[index].to,
      to: editable[index + 1].from,
      opens: false,
      closes: false,
    });
  }
  const last = editable[editable.length - 1];
  if (last.to < text.length) {
    spans.push({ from: last.to, to: text.length, opens: false, closes: true });
  }
  if (spans.length === 0) {
    return null;
  }
  return spans.map((span) => ({
    text: text.slice(span.from, span.to),
    startLine: lineOf(text, span.from),
    endLine: lineOf(text, Math.max(span.from, span.to - 1)),
    opensFile: span.opens,
    closesFile: span.closes,
  }));
};

/**
 * The line of `text` where the missing segment stops matching, from 1.
 *
 * The segment is compared at every place it could begin after the segments
 * before it, and the place where most of it matches is taken; the line that
 * holds the first character that differs is the altered one. The same
 * reading as `interactiveCodeFirstAlteredLine` in the Sphinx editor, so the
 * two name the same line.
 */
const firstAlteredLine = (
  text: string,
  segment: ProtectedSegment,
  position: number
): number => {
  const wanted = segment.text;
  let bestAt = position;
  let bestLength = -1;
  const consider = (at: number) => {
    let length = 0;
    while (
      length < wanted.length &&
      at + length < text.length &&
      text.charCodeAt(at + length) === wanted.charCodeAt(length)
    ) {
      length += 1;
    }
    if (length > bestLength) {
      bestLength = length;
      bestAt = at;
    }
  };
  if (segment.opensFile) {
    consider(0);
  } else {
    for (let at = position; at < text.length; at++) {
      if (text.charCodeAt(at) === wanted.charCodeAt(0)) {
        consider(at);
      }
    }
  }
  const offset = Math.min(
    bestLength < 0 ? position : bestAt + bestLength,
    text.length
  );
  return lineOf(text, offset);
};

/**
 * Find every segment in `text`, in order, and the editable gaps between
 * them. A list with no segments is intact, and the whole text is editable.
 */
export const anchorSegments = (
  text: string,
  segments: ProtectedSegment[]
): Anchoring => {
  if (segments.length === 0) {
    return {
      intact: true,
      anchors: [],
      editable: [{ from: 0, to: text.length }],
    };
  }
  const anchors: SegmentAnchor[] = [];
  let position = 0;
  for (const [index, segment] of segments.entries()) {
    let at = -1;
    if (segment.opensFile && segment.closesFile) {
      at = text === segment.text ? 0 : -1;
    } else if (segment.opensFile) {
      at = position === 0 && text.startsWith(segment.text) ? 0 : -1;
    } else if (segment.closesFile) {
      const from = text.length - segment.text.length;
      at = from >= position && text.endsWith(segment.text) ? from : -1;
    } else {
      at = text.indexOf(segment.text, position);
    }
    if (at < 0) {
      return {
        intact: false,
        failed: index,
        line: firstAlteredLine(text, segment, position),
      };
    }
    anchors.push({ from: at, to: at + segment.text.length });
    position = at + segment.text.length;
  }
  const editable: EditableRegion[] = [];
  if (!segments[0].opensFile) {
    editable.push({ from: 0, to: anchors[0].from });
  }
  for (let index = 0; index + 1 < anchors.length; index++) {
    editable.push({ from: anchors[index].to, to: anchors[index + 1].from });
  }
  if (!segments[segments.length - 1].closesFile) {
    editable.push({ from: anchors[anchors.length - 1].to, to: text.length });
  }
  return { intact: true, anchors, editable };
};

/**
 * Where the segments stand in the current text, for a snapshot.
 *
 * The editable regions the editor mapped through every edit are the precise
 * answer: the protected spans are what lies between them. They are checked
 * against the segments' text, and where they disagree - which a filter that
 * held would never allow - the segments are located by text instead. A
 * segment that cannot be found at all is reported at -1.
 */
export const locateSegments = (
  text: string,
  segments: ProtectedSegment[],
  editable: EditableRegion[]
): ProtectedSpan[] => {
  if (segments.length === 0) {
    return [];
  }
  const sorted = [...editable].sort((left, right) => left.from - right.from);
  const pieces: SegmentAnchor[] = [];
  let start = 0;
  for (const region of sorted) {
    pieces.push({ from: start, to: region.from });
    start = region.to;
  }
  pieces.push({ from: start, to: text.length });
  if (!segments[0].opensFile) {
    pieces.shift();
  }
  if (!segments[segments.length - 1].closesFile) {
    pieces.pop();
  }
  const fits =
    sorted.length !== 0 &&
    pieces.length === segments.length &&
    pieces.every(
      (piece, index) =>
        piece.from <= piece.to &&
        text.slice(piece.from, piece.to) === segments[index].text
    );
  if (fits) {
    return segments.map((segment, index) => ({
      text: segment.text,
      from: pieces[index].from,
      to: pieces[index].to,
    }));
  }
  const found = anchorSegments(text, segments);
  return segments.map((segment, index) => {
    const anchor = found.intact ? found.anchors[index] : undefined;
    return {
      text: segment.text,
      from: anchor?.from ?? -1,
      to: anchor?.to ?? -1,
    };
  });
};
