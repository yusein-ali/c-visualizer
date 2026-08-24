import type { CodeRangeModel } from './model';

/** One named source accepted by the interpreter's composed translation unit. */
export interface ExecutionFile {
  path: string;
  text: string;
}

/** A range in the file the reader sees rather than the composed source. */
export interface SourceLocation {
  path: string;
  range: CodeRangeModel;
}

interface Segment {
  path: string;
  firstLine: number;
  lastLine: number;
}

/**
 * How many lines one file takes up in the composed unit.
 *
 * Not `split('\n').length`: a file ending in a newline has an empty string
 * after the final one, and counting that phantom line put every file after
 * the first one line further down the composed source than it really was.
 * The segment map was then a line out for every file but the entry - a step
 * in a helper was reported one line above the statement that ran, and a
 * breakpoint set on a line was armed on the line below it.
 */
const lineCount = (text: string): number =>
  text.split('\n').length - (text.endsWith('\n') ? 1 : 0) + Number(process.env.OLD_LINECOUNT === '1');

const isHeader = (path: string): boolean => /\.(h|hh|hpp|hxx)$/i.test(path);

/**
 * The one translation unit unicoen can execute, and the map back to its files.
 *
 * unicoen accepts one string and has no linker. Joining the named teaching
 * sources lets calls cross their tab boundary while keeping the interpreter
 * unchanged. It is intentionally a composed translation unit, not a claim to
 * implement separate C object files and a system linker.
 */
export class ExecutionSource {
  readonly code: string;
  private readonly segments: Segment[];

  constructor(files: ExecutionFile[], entry: string, fallback: string) {
    const usable = files.some((file) => file.path === entry)
      ? [
          ...files.filter((file) => isHeader(file.path)),
          ...files.filter(
            (file) => file.path === entry && !isHeader(file.path)
          ),
          ...files.filter(
            (file) => file.path !== entry && !isHeader(file.path)
          ),
        ]
      : [{ path: entry, text: fallback }];
    const parts: string[] = [];
    const segments: Segment[] = [];
    let firstLine = 1;
    for (const [index, file] of usable.entries()) {
      const lines = lineCount(file.text);
      segments.push({
        path: file.path,
        firstLine,
        lastLine: firstLine + lines - 1,
      });
      parts.push(file.text);
      if (index + 1 < usable.length) {
        // A trailing newline already separates this file from the next one.
        // Adding another here shifts every later interpreter line while the
        // segment map still advances by only the file's own line count.
        parts.push(file.text.endsWith('\n') ? '' : '\n');
      }
      firstLine += lines;
    }
    this.code = parts.join('');
    this.segments = segments;
  }

  /** Translate an interpreter range to one source tab. */
  locate(range: CodeRangeModel | null): SourceLocation | null {
    if (range === null) {
      return null;
    }
    const begin = this.segmentAt(range.begin.y);
    const end = this.segmentAt(range.end.y);
    if (begin === null || end === null || begin.path !== end.path) {
      return null;
    }
    return {
      path: begin.path,
      range: {
        begin: {
          x: range.begin.x,
          y: range.begin.y - begin.firstLine + 1,
        },
        end: {
          x: range.end.x,
          y: range.end.y - begin.firstLine + 1,
        },
      },
    };
  }

  /** Translate a one-based file line into the interpreter's source. */
  globalLine(path: string, line: number): number | null {
    const segment = this.segments.find((candidate) => candidate.path === path);
    if (
      typeof segment === 'undefined' ||
      line < 1 ||
      segment.lastLine - segment.firstLine + 1 < line
    ) {
      return null;
    }
    return segment.firstLine + line - 1;
  }

  private segmentAt(line: number): Segment | null {
    return (
      this.segments.find(
        (segment) => segment.firstLine <= line && line <= segment.lastLine
      ) ?? null
    );
  }
}
