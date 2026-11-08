import {
  anchorSegments,
  locateSegments,
  mergeLineRanges,
  segmentsFromLines,
  segmentsFromOffsets,
  sourceLineCount,
} from '../src/ui/editor';
import type { ProtectedSegment } from '../src/ui/editor';

/**
 * Protected segments: the text an exercise holds fixed, found again by its
 * exact text whenever a file is replaced.
 *
 * The segments cut by line must be the ones the Sphinx build writes for the
 * same `:editable-lines:` - a block's editor and the visualizer opened from
 * it accept and refuse the same text only if they cut the same spans - so
 * the expectations below are what `interactive_code_editable.py` produces
 * for this program.
 */

const PROGRAM =
  '#include <stdio.h>\n\nint main(void) {\n  int x = 1;\n  int y = 2;\n' +
  '  printf("%d\\n", x + y);\n  return 0;\n}\n';

const cut = (ranges: [number, number][]): ProtectedSegment[] => {
  const segments = segmentsFromLines(PROGRAM, ranges);
  if (typeof segments === 'string') {
    throw new Error(`no segments: ${segments}`);
  }
  return segments;
};

const python = (segments: ProtectedSegment[]) =>
  segments.map((segment) => ({
    start_line: segment.startLine,
    end_line: segment.endLine,
    text: segment.text,
  }));

describe('cutting segments from editable lines', () => {
  it('counts lines the way an author does', () => {
    expect(sourceLineCount('')).toBe(0);
    expect(sourceLineCount('a')).toBe(1);
    expect(sourceLineCount('a\n')).toBe(1);
    expect(sourceLineCount('a\nb')).toBe(2);
    expect(sourceLineCount(PROGRAM)).toBe(8);
  });

  it('merges overlapping and adjacent ranges', () => {
    expect(
      mergeLineRanges([
        [6, 6],
        [4, 4],
        [5, 5],
        [9, 12],
        [10, 11],
      ])
    ).toEqual([
      [4, 6],
      [9, 12],
    ]);
  });

  it('cuts the spans the Sphinx build writes for 4-5', () => {
    expect(python(cut([[4, 5]]))).toEqual([
      {
        start_line: 1,
        end_line: 3,
        text: '#include <stdio.h>\n\nint main(void) {\n',
      },
      {
        start_line: 6,
        end_line: 8,
        text: '\n  printf("%d\\n", x + y);\n  return 0;\n}\n',
      },
    ]);
  });

  it('cuts the spans the Sphinx build writes for 1, 8', () => {
    expect(
      python(
        cut([
          [1, 1],
          [8, 8],
        ])
      )
    ).toEqual([
      {
        start_line: 2,
        end_line: 7,
        text: '\n\nint main(void) {\n  int x = 1;\n  int y = 2;\n  printf("%d\\n", x + y);\n  return 0;\n',
      },
    ]);
  });

  it('cuts the spans the Sphinx build writes for 4, 6', () => {
    const segments = cut([
      [4, 4],
      [6, 6],
    ]);
    expect(python(segments)).toEqual([
      {
        start_line: 1,
        end_line: 3,
        text: '#include <stdio.h>\n\nint main(void) {\n',
      },
      { start_line: 5, end_line: 5, text: '\n  int y = 2;\n' },
      { start_line: 7, end_line: 8, text: '\n  return 0;\n}\n' },
    ]);
    expect(segments.map((segment) => segment.opensFile)).toEqual([
      true,
      false,
      false,
    ]);
    expect(segments.map((segment) => segment.closesFile)).toEqual([
      false,
      false,
      true,
    ]);
  });

  it('protects nothing when a range lies past the last line', () => {
    expect(segmentsFromLines(PROGRAM, [[4, 9]])).toBe('outside');
  });

  it('protects nothing when no line or every line is named', () => {
    expect(segmentsFromLines(PROGRAM, [])).toBe('empty');
    expect(segmentsFromLines(PROGRAM, [[1, 8]])).toBe('everything');
  });
});

describe('finding the segments again', () => {
  it('leaves the editable lines as the gaps between them', () => {
    const found = anchorSegments(PROGRAM, cut([[4, 5]]));
    expect(found.intact).toBe(true);
    if (found.intact) {
      expect(
        found.editable.map((region) => PROGRAM.slice(region.from, region.to))
      ).toEqual(['  int x = 1;\n  int y = 2;']);
    }
  });

  it('accepts a text whose editable lines grew', () => {
    const changed = PROGRAM.replace(
      '  int y = 2;',
      '  int y = 2;\n  int z = 3;\n  y += z;'
    );
    const found = anchorSegments(changed, cut([[4, 5]]));
    expect(found.intact).toBe(true);
    if (found.intact) {
      expect(changed.slice(found.editable[0].from, found.editable[0].to)).toBe(
        '  int x = 1;\n  int y = 2;\n  int z = 3;\n  y += z;'
      );
    }
  });

  it('keeps an emptied editable line as a place to type', () => {
    const segments = cut([
      [4, 4],
      [6, 6],
    ]);
    const emptied = PROGRAM.replace('  int x = 1;', '');
    const found = anchorSegments(emptied, segments);
    expect(found.intact).toBe(true);
    if (found.intact) {
      expect(found.editable[0].from).toBe(found.editable[0].to);
    }
  });

  it('refuses a text that changed a protected line and names that line', () => {
    const altered = PROGRAM.replace('return 0;', 'return 1;');
    const found = anchorSegments(altered, cut([[4, 5]]));
    expect(found).toEqual({ intact: false, failed: 1, line: 7 });
  });

  it('refuses a text whose first line was changed', () => {
    const altered = PROGRAM.replace('<stdio.h>', '<stdlib.h>');
    const found = anchorSegments(altered, cut([[4, 5]]));
    expect(found).toEqual({ intact: false, failed: 0, line: 1 });
  });

  it('holds a closing segment to the end of the text', () => {
    const found = anchorSegments(`${PROGRAM}// more\n`, cut([[4, 5]]));
    expect(found.intact).toBe(false);
  });
});

describe('segments around offsets', () => {
  const doc = 'int main() {\n  return 0;\n}';
  const blank = { from: doc.indexOf('0;'), to: doc.indexOf('0;') + 1 };

  it('is the text between the regions', () => {
    const segments = segmentsFromOffsets(doc, [blank]);
    expect(segments?.map((segment) => segment.text)).toEqual([
      'int main() {\n  return ',
      ';\n}',
    ]);
  });

  it('is nothing for no regions, or regions over everything', () => {
    expect(segmentsFromOffsets(doc, [])).toBeNull();
    expect(segmentsFromOffsets(doc, [{ from: 0, to: doc.length }])).toBeNull();
  });

  it('lets an empty region at the start stand before the first span', () => {
    const segments = segmentsFromOffsets(doc, [{ from: 0, to: 0 }]);
    expect(segments).toHaveLength(1);
    expect(segments?.[0].opensFile).toBe(false);
    expect(segments?.[0].closesFile).toBe(true);
    const found = anchorSegments(`// note\n${doc}`, segments ?? []);
    expect(found.intact).toBe(true);
  });

  it('locates the spans through the regions the editor kept', () => {
    const segments = segmentsFromOffsets(doc, [blank]) ?? [];
    const typed = doc.replace('return 0;', 'return 42;');
    const spans = locateSegments(typed, segments, [
      { from: blank.from, to: blank.from + 2 },
    ]);
    expect(spans).toEqual([
      { text: 'int main() {\n  return ', from: 0, to: blank.from },
      { text: ';\n}', from: blank.from + 2, to: typed.length },
    ]);
  });

  it('reports a span the text has lost at -1', () => {
    const segments = segmentsFromOffsets(doc, [blank]) ?? [];
    expect(locateSegments('int x;', segments, [])).toEqual([
      { text: 'int main() {\n  return ', from: -1, to: -1 },
      { text: ';\n}', from: -1, to: -1 },
    ]);
  });
});
