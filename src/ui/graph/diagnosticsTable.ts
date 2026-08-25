import { dia, shapes } from '@joint/core';
import { DEBUG_STATE } from '../../core';
import strings from '../../strings';

/**
 * One finding, from whichever checker found it.
 *
 * The canvas draws what it is handed and looks nothing up, so a row carries
 * the file and line it belongs to rather than a reference into the editor's
 * state: clicking it sends those coordinates back out through `onNavigate`,
 * and the controller that owns the tabs decides what to open.
 *
 * `origin` is the column that makes the table worth reading twice. The local
 * checker parses the tab a reader is editing as they type; the build is the
 * course's own compiler answering about every file at once. Two findings on
 * one line can disagree, and a reader who cannot tell which is which has no
 * way to know that the parser is stricter here than GCC, or the reverse.
 */
export interface DiagnosticEntry {
  severity: 'error' | 'warning' | 'info';
  origin: 'local' | 'build';
  /** The file the finding is in, as the tab strip names it. */
  path: string;
  /** One-based, as the editor's gutter counts. */
  line: number;
  /** Zero-based, as CodeMirror addresses columns. */
  column: number;
  message: string;
  /** The rule or compiler option, `-Wunused-variable` or a parser rule. */
  rule?: string;
}

/**
 * What the diagnostics of this program are doing at the moment.
 *
 * The two checkers are asked at different times by different presses - the
 * local one on a pause in typing, the build on the Build button - and both
 * take long enough for a reader to wonder whether anything is happening. The
 * status line above the table is where that is answered, and these are the
 * four things it can be answering about.
 */
export type DiagnosticActivity =
  | 'localRunning'
  | 'localComplete'
  | 'buildStarted'
  | 'buildComplete';

/** A statement at which the interpreter terminated before normal EOF. */
export interface InvalidStatementRunStatus {
  kind: 'invalidStatement';
  path: string;
  /** One-based, as the source editor displays it. */
  line: number;
}

/**
 * The first error that refused a run, where the checker found it.
 *
 * The bare `'rejected'` below says only that the program was not run, and a
 * reader who pressed Step and saw the canvas stay empty is asking the next
 * question: where. Every refusal has an answer to it - the preflight already
 * sends the file and the line it is sending the editor to - so the status
 * line carries them rather than making the reader go and read the table.
 */
export interface RejectedRunStatus {
  kind: 'rejected';
  path: string;
  /** One-based, as the source editor displays it. */
  line: number;
  /** What the checker said, without the position it repeats. */
  message: string;
}

/**
 * Where a live session is sitting, and what put it there.
 *
 * The status line used to print the interpreter's own state name - `stdin`,
 * `First` - which names the machine rather than the thing a reader is asking
 * about. What they are asking is whether the program is moving, whether it is
 * waiting on them, and, when it is doing neither, which line it stopped on
 * and whether it stopped there because they marked it.
 *
 * `atBreakpoint` is not `line` looked up in the breakpoint table: a step can
 * land on a marked line without the mark being what stopped it. Only the
 * interpreter knows which of the two happened, and it says so.
 */
export interface DebugPosition {
  /** The file the session is stopped in, as the tab strip names it. */
  path: string;
  /** One-based, as the source editor displays it. */
  line: number;
  /** A mark stopped the run here, rather than a step the reader took. */
  atBreakpoint: boolean;
}

/** Whether two positions name the same stop, for skipping a redraw. */
export const sameDebugPosition = (
  one: DebugPosition | null,
  other: DebugPosition | null
): boolean =>
  one === other ||
  (one !== null &&
    other !== null &&
    one.path === other.path &&
    one.line === other.line &&
    one.atBreakpoint === other.atBreakpoint);

/** Why the latest run did not proceed normally, or null after a reset. */
export type RunStatus =
  | 'rejected'
  | 'stoppedOnError'
  | InvalidStatementRunStatus
  | RejectedRunStatus
  | null;

const runStatusText: Record<'rejected' | 'stoppedOnError', string> = {
  rejected: strings.diagnosticsRunRejected,
  stoppedOnError: strings.diagnosticsRunStoppedOnError,
};

const activityText: Record<DiagnosticActivity, string> = {
  localRunning: strings.diagnosticsLocalRunning,
  localComplete: strings.diagnosticsLocalComplete,
  buildStarted: strings.diagnosticsBuildStarted,
  buildComplete: strings.diagnosticsBuildComplete,
};

/** Whether a checker is still working, which is what keeps the line current. */
export const activityIsPending = (
  activity: DiagnosticActivity | null
): boolean => activity === 'localRunning' || activity === 'buildStarted';

/**
 * How the band reads, which is what a reader takes from it before they have
 * read a word of it.
 *
 * The sentence in the strip changes seven times in a session and a reader
 * learns to skim it, so what the colour is for is the moment the program has
 * stopped being a thing they watch and become a thing they must act on. Three
 * of these are that moment: the run was broken by a mark they set, the
 * program is blocked waiting for them to type, or it failed.
 *
 * `running` is the opposite signal - nothing is wanted, the machine has it -
 * and it is here so that stopping is a change of colour rather than the
 * appearance of one. Everything else is `normal`: the checkers reporting, an
 * idle line, a program that ran to its end, and single-stepping, which is a
 * reader already in the middle of acting.
 *
 * Colour is never the only carrier. The sentence still names the state, the
 * file and the line, so a reader who cannot tell these washes apart loses
 * nothing but the glance.
 */
export type StatusTone = 'normal' | 'running' | 'break' | 'input' | 'error';

export interface DiagnosticStatus {
  text: string;
  tone: StatusTone;
}

/**
 * What a live session is doing, in the reader's terms rather than the
 * interpreter's.
 *
 * `EOF` is the end of the program, which is a thing a reader understands and
 * `EOF` is not: the session is still live - the memory it finished with is
 * still on the canvas - but nothing is going to move again without a restart.
 * It is `normal` rather than a colour of its own because a program that ran
 * to its end is not asking the reader for anything.
 *
 * The position is what separates the two ways of standing still, so a stop
 * the interpreter could not map back to a visible tab says that it is stopped
 * and stops there. Naming the state instead would put the interpreter's own
 * vocabulary back on the line this exists to keep it off.
 */
const debugStatus = (
  debugState: DEBUG_STATE,
  position: DebugPosition | null
): DiagnosticStatus => {
  if (debugState === 'Executing') {
    return { text: strings.diagnosticsDebugRunning, tone: 'running' };
  }
  if (debugState === 'stdin') {
    return { text: strings.diagnosticsDebugWaitingInput, tone: 'input' };
  }
  if (debugState === 'EOF') {
    return { text: strings.diagnosticsDebugFinished, tone: 'normal' };
  }
  const atBreakpoint = position !== null && position.atBreakpoint;
  const label = atBreakpoint
    ? strings.diagnosticsDebugAtBreakpoint
    : strings.diagnosticsDebugSingleStep;
  return {
    text:
      position === null ? label : `${label}: ${position.path}:${position.line}`,
    tone: atBreakpoint ? 'break' : 'normal',
  };
};

/** What a refused or terminated run says, in one sentence. */
const runStatusMessage = (runStatus: Exclude<RunStatus, null>): string => {
  if (typeof runStatus === 'string') {
    return runStatusText[runStatus];
  }
  return runStatus.kind === 'rejected'
    ? `${strings.diagnosticsRunRejectedAt} ${runStatus.path}:${runStatus.line}: ${runStatus.message}`
    : `${strings.diagnosticsRunStoppedAt} ${runStatus.path}:${runStatus.line} ${strings.diagnosticsRunInvalidStatement}`;
};

/**
 * The one sentence above the table, and the wash it is written on.
 *
 * Work in progress outranks everything: a reader waiting on a build is asking
 * about the build. A run outranks a finished check for the same reason - the
 * debugger is the thing that is moving. What is left is the last checker to
 * finish, until nothing has happened for long enough that saying so would be
 * reporting history rather than state, and the line goes idle.
 *
 * The tone comes out of the same resolution as the sentence rather than being
 * worked out again beside it, which is what stops a band from being coloured
 * for a run that the line above it is no longer reporting.
 */
export const diagnosticStatus = (
  activity: DiagnosticActivity | null,
  debugState: DEBUG_STATE,
  idle: boolean,
  runStatus: RunStatus = null,
  position: DebugPosition | null = null
): DiagnosticStatus => {
  if (activity !== null && activityIsPending(activity)) {
    return { text: activityText[activity], tone: 'normal' };
  }
  // A run that failed: refused before it started, or killed part-way by a
  // fatal error. Distinct from the two ordinary ways a run stops - a mark and
  // a read - which are the program doing what it was asked to.
  if (runStatus !== null) {
    return { text: runStatusMessage(runStatus), tone: 'error' };
  }
  if (debugState !== 'Stop') {
    return debugStatus(debugState, position);
  }
  if (idle || activity === null) {
    return { text: strings.diagnosticsIdle, tone: 'normal' };
  }
  return { text: activityText[activity], tone: 'normal' };
};

/** The sentence alone, for callers with nothing to colour. */
export const diagnosticStatusText = (
  activity: DiagnosticActivity | null,
  debugState: DEBUG_STATE,
  idle: boolean,
  runStatus: RunStatus = null,
  position: DebugPosition | null = null
): string =>
  diagnosticStatus(activity, debugState, idle, runStatus, position).text;

const severityText: Record<DiagnosticEntry['severity'], string> = {
  error: strings.diagnosticsSeverityError,
  warning: strings.diagnosticsSeverityWarning,
  info: strings.diagnosticsSeverityInfo,
};

const originText: Record<DiagnosticEntry['origin'], string> = {
  local: strings.diagnosticsSourceLocal,
  build: strings.diagnosticsSourceBuild,
};

/** The fill a row is banded with, so severity reads before the sentence does. */
const severityFill: Record<DiagnosticEntry['severity'], string> = {
  error: 'var(--plivet-graph-error, #fdecea)',
  warning: 'var(--plivet-graph-warning, #fff8e1)',
  info: 'var(--plivet-graph-surface, #ffffff)',
};

const severityInk: Record<DiagnosticEntry['severity'], string> = {
  error: 'var(--plivet-graph-error-text, #8c1d18)',
  warning: 'var(--plivet-graph-warning-text, #5c5130)',
  info: 'var(--plivet-graph-ink, #26384a)',
};

export const STATUS_HEIGHT = 26;
const HEADER_HEIGHT = 26;
const ROW_HEIGHT = 30;
const FONT = 'system-ui, sans-serif';
const CODE_FONT = "Consolas, 'Courier New', monospace";

/** The five columns, in the order the table reads them. */
const COLUMN_WIDTHS = {
  severity: 88,
  source: 78,
  file: 150,
  line: 58,
};
const TYPE_MINIMUM = 200;

/**
 * Where each column starts and how wide it is, for a table of this width.
 *
 * The four short columns are fixed: they hold a word or a number, and a table
 * whose severity column grew with the window would put the sentence somewhere
 * different at every size. What is left goes to the message, down to a floor -
 * below that the table is wider than the view and the paper scrolls, which is
 * the honest answer for a narrow window.
 */
export const diagnosticColumns = (
  tableWidth: number
): { x: number; width: number }[] => {
  const fixed =
    COLUMN_WIDTHS.severity +
    COLUMN_WIDTHS.source +
    COLUMN_WIDTHS.file +
    COLUMN_WIDTHS.line;
  const type = Math.max(TYPE_MINIMUM, tableWidth - fixed);
  const widths = [
    COLUMN_WIDTHS.severity,
    COLUMN_WIDTHS.source,
    COLUMN_WIDTHS.file,
    COLUMN_WIDTHS.line,
    type,
  ];
  let x = 0;
  return widths.map((width) => {
    const column = { x, width };
    x += width;
    return column;
  });
};

const leftLabel = (height: number) => ({
  x: 10,
  y: height / 2,
  textAnchor: 'start' as const,
  textVerticalAnchor: 'middle' as const,
});

const cell = (
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    fill?: string;
    ink?: string;
    stroke?: string;
    header?: boolean;
    code?: boolean;
    index?: number;
  } = {}
): dia.Element => {
  const { fill, ink, stroke, header = false, code = false, index } = options;
  const element = new shapes.standard.Rectangle({ z: 4 });
  element.position(x, y);
  element.resize(width, height);
  const marks =
    typeof index === 'undefined'
      ? {}
      : {
          'data-diagnostic-index': String(index),
          class: 'plivet-diagnostic-cell',
        };
  element.attr({
    body: {
      fill:
        fill ??
        (header
          ? 'var(--plivet-graph-header, #eef2f6)'
          : 'var(--plivet-graph-surface, #ffffff)'),
      stroke: stroke ?? 'var(--plivet-graph-grid, #cfd8e1)',
      ...marks,
    },
    label: {
      text,
      fill:
        ink ??
        (header
          ? 'var(--plivet-graph-header-text, #4a5b6c)'
          : 'var(--plivet-graph-ink, #26384a)'),
      fontFamily: code ? CODE_FONT : FONT,
      fontSize: 12,
      fontWeight: header ? 'bold' : 'normal',
      ...leftLabel(height),
      textWrap: { width: -16, height: -6, ellipsis: true },
      ...marks,
    },
  });
  return element;
};

/**
 * The wash each tone is drawn in.
 *
 * Four hues, far enough apart to be told apart at a glance and in a
 * screenshot: blue while the machine has it, amber where a mark stopped it,
 * green where it is waiting to be typed at, red where it failed. The error
 * row reuses the findings table's own error colours, because a halted run and
 * the finding that explains it are one answer read downwards and two reds
 * would make them look like two systems.
 *
 * Each is a wash with its own outline. A tint the width of the canvas with no
 * edge reads as a background rather than as a state.
 */
const TONE_PALETTE: Record<
  StatusTone,
  { fill: string; ink: string; stroke?: string }
> = {
  normal: {
    fill: 'var(--plivet-graph-caption, #f7f9fb)',
    ink: 'var(--plivet-graph-caption-text, #6b7b8c)',
  },
  running: {
    fill: 'var(--plivet-graph-status-running, #e8f2ff)',
    ink: 'var(--plivet-graph-status-running-text, #234b73)',
    stroke: 'var(--plivet-graph-status-running-line, #4f81bd)',
  },
  break: {
    fill: 'var(--plivet-graph-status-break, #fff3bf)',
    ink: 'var(--plivet-graph-status-break-text, #6b5200)',
    stroke: 'var(--plivet-graph-status-break-line, #d9a400)',
  },
  input: {
    fill: 'var(--plivet-graph-status-input, #e4f5ea)',
    ink: 'var(--plivet-graph-status-input-text, #1d5c38)',
    stroke: 'var(--plivet-graph-status-input-line, #3f9e64)',
  },
  error: {
    fill: 'var(--plivet-graph-error, #fdecea)',
    ink: 'var(--plivet-graph-error-text, #8c1d18)',
    stroke: 'var(--plivet-graph-error-line, #d7857f)',
  },
};

/** The status sentence, in a band the width of the table above its header. */
export function diagnosticStatusCell(
  text: string,
  originX: number,
  originY: number,
  tableWidth: number,
  tone: StatusTone = 'normal'
): dia.Element {
  return cell(
    text,
    originX,
    originY,
    tableWidth,
    STATUS_HEIGHT,
    TONE_PALETTE[tone]
  );
}

/**
 * The findings as a table whose rows are clickable.
 *
 * A row carries its index rather than its coordinates: the index is what comes
 * back through the paper's click, and the canvas still holds the list it drew,
 * so nothing has to be encoded into an attribute and decoded out of it.
 *
 * The order is severity first and then file and line, because a reader with
 * eleven warnings and one error is looking for the error - and because it is
 * the error that stops the debugger from starting, which is the question this
 * table exists to answer.
 */
export function diagnosticsTableCells(
  entries: DiagnosticEntry[],
  originX: number,
  originY: number,
  tableWidth: number
): { cells: dia.Cell[]; height: number; width: number } {
  const columns = diagnosticColumns(tableWidth);
  const width = columns.reduce(
    (total, column) => Math.max(total, column.x + column.width),
    0
  );
  const cells: dia.Cell[] = [];
  const titles = [
    strings.diagnosticsColumnSeverity,
    strings.diagnosticsColumnSource,
    strings.diagnosticsColumnFile,
    strings.diagnosticsColumnLine,
    strings.diagnosticsColumnType,
  ];
  let y = originY;
  titles.forEach((title, index) => {
    cells.push(
      cell(
        title,
        originX + columns[index].x,
        y,
        columns[index].width,
        HEADER_HEIGHT,
        { header: true }
      )
    );
  });
  y += HEADER_HEIGHT;

  entries.forEach((entry, index) => {
    const values = [
      severityText[entry.severity],
      originText[entry.origin],
      entry.path,
      String(entry.line),
      typeof entry.rule === 'undefined' || entry.rule === ''
        ? entry.message
        : `${entry.rule}: ${entry.message}`,
    ];
    values.forEach((value, column) => {
      cells.push(
        cell(
          value,
          originX + columns[column].x,
          y,
          columns[column].width,
          ROW_HEIGHT,
          {
            // The band is the severity's, so the row reads as one finding
            // rather than five cells that happen to be side by side.
            fill: severityFill[entry.severity],
            ink: column === 0 ? severityInk[entry.severity] : undefined,
            code: column === 2 || column === 4,
            index,
          }
        )
      );
    });
    y += ROW_HEIGHT;
  });

  return { cells, height: y - originY, width };
}

/**
 * The order the table is drawn in: errors before warnings before notes, then
 * by file and line. It sorts a copy - the list belongs to whoever handed it
 * over, and the canvas draws rather than rearranges what it is given.
 */
const SEVERITY_ORDER: Record<DiagnosticEntry['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export const sortedDiagnostics = (
  entries: DiagnosticEntry[]
): DiagnosticEntry[] =>
  entries.slice().sort((one, other) => {
    const bySeverity =
      SEVERITY_ORDER[one.severity] - SEVERITY_ORDER[other.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byPath = one.path.localeCompare(other.path);
    return byPath === 0 ? one.line - other.line : byPath;
  });

/**
 * Whether two answers say the same thing.
 *
 * The findings are re-published whenever either checker speaks, and a run
 * publishes them on every step it reports a runtime finding on. Redrawing the
 * whole scene to put back the table that is already on it would cost a rebuild
 * per step for a picture nobody could tell apart, so an answer that has not
 * changed is not an answer the canvas has to act on.
 */
export const sameDiagnostics = (
  one: DiagnosticEntry[],
  other: DiagnosticEntry[]
): boolean =>
  one.length === other.length &&
  one.every((entry, index) => {
    const against = other[index];
    return (
      entry.severity === against.severity &&
      entry.origin === against.origin &&
      entry.path === against.path &&
      entry.line === against.line &&
      entry.column === against.column &&
      entry.message === against.message &&
      entry.rule === against.rule
    );
  });
