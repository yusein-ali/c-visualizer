import {
  Request,
  SourceFile,
  CONTROL_EVENT,
  InterpreterClient,
  LintDiagnosticModel,
  Response,
  RUN_EVENT,
  RuntimeDiagnosticModel,
  DEBUG_STATE,
  CodeRangeModel,
  ExecutionSource,
  ExpressionModel,
  ExpressionNodeModel,
  FileBreakpoints,
  FileLints,
  FileSyntaxErrors,
  StepModel,
  SourceLocation,
  SyntaxErrorModel,
} from '../core';
import strings from '../strings';
import { defaultProgram } from '../defaultProgram';
import { Construct } from '../interpreter/Construct';
import { Expansion, originalRange } from '../interpreter/Expansion';
import {
  DeclarationRequest,
  EditableRegion,
  LibraryFunction,
  SessionJSON,
  containsMainDefinition,
  PlivetEditor,
  ProgramCompletions,
  goTo,
  offsetAt,
  rangeOf,
  rowRange,
  TeachingDiagnostic,
  BreakpointState,
} from '../ui/editor';
import type { BreakpointEntry } from '../ui/breakpoints';
import {
  declarationFor,
  functionDefinitionFor,
  macroDefinitionLine,
} from './declarations';
import { HoverTextSource } from './hoverText';
import { libraryHelp, libraryNames } from './libraryHelp';
import { Bus } from './emitter';
import { TabBar } from '../ui/tabs';
import type { ZOOM_COMMAND } from '../ui/controls';
import type {
  DebugPosition,
  DiagnosticEntry,
  MemoryNavigationTarget,
  RunStatus,
} from '../ui/graph';
import type {
  CodeMirrorConfig,
  DiagnosticOptions,
  ExternalDiagnostic,
  SourceSnapshot,
  Unsubscribe,
} from './host';
import { codeMirrorSettings } from './host';

const HEADER_EXTENSION = /\.(?:h|hh|hpp|hxx|h\+\+)$/i;
/** The text size a host that configured none opens at, and Reset returns to. */
const DEFAULT_FONT_SIZE = 14;
/** How far Zoom Out goes, unless the host opened the editor smaller still. */
const MINIMUM_FONT_SIZE = 10;
const PREPROCESS_DELAY = 100;
const SYNTAX_CHECK_DELAY = 1000;

const canBeEntry = (file: Pick<SourceFile, 'path' | 'text'>): boolean =>
  !HEADER_EXTENSION.test(file.path) && containsMainDefinition(file.text);

const entryPathFor = (
  files: Pick<SourceFile, 'path' | 'text'>[],
  requested?: string
): string =>
  files.find((file) => file.path === requested && canBeEntry(file))?.path ??
  files.find(canBeEntry)?.path ??
  files[0].path;

/**
 * The editor's place in the application: it holds the source, sends every
 * debug command to the interpreter, and hands what comes back to the editor
 * and to the rest of the interface.
 *
 * The editing itself belongs to `PlivetEditor` under `src/ui/editor`, which
 * knows nothing about React and nothing about the interpreter. This was
 * `Editor.tsx`, and it is the wiring between the two; what went with React was
 * the component around it, which by then was a `div` and a ref.
 *
 * The bus and the interpreter client are handed in rather than imported: they
 * belong to the `Plivet` that built this controller, and are the two things
 * that used to be the page's.
 */
export interface EditorControllerOptions {
  bus: Bus;
  client: InterpreterClient;
  dark?: boolean;
  /** The program the editor opens with. */
  doc?: string;
  /**
   * Several files instead of one, as tabs. Exactly one of them runs; the
   * rest are open beside it. Given, `doc` is ignored.
   */
  files?: SourceFile[];
  /** Which of `files` is the translation unit. Defaults to the first. */
  entry?: string;
  /**
   * The spans of that program the reader may edit. Left out, the whole file
   * is theirs; given, everything outside them is fixed, which is the shape an
   * exercise usually takes.
   */
  editableRegions?: EditableRegion[];
  /**
   * How the host's own editors are built, in either of the two spellings
   * `codeMirrorSettings` reads. What it names is what this editor is built
   * with; what it does not, the editor's own defaults.
   */
  codeMirror?: CodeMirrorConfig;
  /** Reports a complete immutable snapshot after any source change. */
  onSourceChange?: (snapshot: SourceSnapshot) => void;
  /** Reports tab changes, which do not themselves change the source revision. */
  onActiveFileChange?: (path: string) => void;
}

/** One file's share of what a checker found. */
interface FileFindings {
  errors: SyntaxErrorModel[];
  lints: TeachingDiagnostic[];
}

/**
 * The library entry a rule pointed at, looked up.
 *
 * The rule runs in the Worker and names the function; `libraryHelp` is the one
 * place that knows what the function is, and lives on this side. The editor
 * formats what it is handed and looks nothing up.
 */
const withLibraryHelp = (lint: LintDiagnosticModel): TeachingDiagnostic => {
  const help = typeof lint.help === 'undefined' ? null : libraryHelp(lint.help);
  const { help: _named, ...rest } = lint;
  return help === null ? rest : { ...rest, help };
};

/**
 * A runtime diagnostic as the linter takes one.
 *
 * The two disagree about one thing: the interpreter's end column names the
 * last character of the expression and a diagnostic's names the one after it,
 * which is the same conversion `rangeOf` makes for the step highlight.
 */
const asDiagnostic = (found: RuntimeDiagnosticModel): TeachingDiagnostic => ({
  rule: found.rule,
  severity: found.severity,
  message: found.message,
  line: found.line,
  column: found.column,
  endLine: found.endLine,
  endColumn: found.endColumn + 1,
});

/**
 * The position `SyntaxErrorData` stamps on the head of its own message.
 * unicoen writes `line 1:15 ` in front of every one, and the status line
 * prints the file and the line itself, so carrying both would say it twice.
 */
const REPEATED_POSITION = /^line \d+:\d+\s*/;

/**
 * What the status line says about a run the preflight refused.
 *
 * The file is the one the editor is being switched to, so the sentence names
 * the tab the reader is about to be looking at rather than whichever file the
 * server happened to list first. A refusal with no error to point at is not a
 * shape the preflight produces, but the reader still has to be told that the
 * run did not happen, so the bare sentence remains for it.
 */
const rejectionStatus = (
  found: FileSyntaxErrors[],
  firstPath: string | undefined
): RunStatus => {
  const file = found.find((entry) => entry.path === firstPath) ?? found[0];
  const error = file?.errors[0];
  if (typeof file === 'undefined' || typeof error === 'undefined') {
    return 'rejected';
  }
  return {
    kind: 'rejected',
    path: file.path,
    line: error.line,
    message: error.msg.replace(REPEATED_POSITION, ''),
  };
};

const isPosition = (
  value: ExternalDiagnostic['from'] | undefined
): value is ExternalDiagnostic['from'] =>
  typeof value !== 'undefined' &&
  Number.isInteger(value.line) &&
  0 <= value.line &&
  Number.isInteger(value.column) &&
  0 <= value.column;

/** Host coordinates are zero-based and end-exclusive; editor rows are 1-based. */
const externalDiagnostic = (
  source: string,
  found: ExternalDiagnostic
): TeachingDiagnostic | null => {
  if (
    found.path === '' ||
    found.message === '' ||
    !['error', 'warning', 'info'].includes(found.severity) ||
    !isPosition(found.from) ||
    !isPosition(found.to) ||
    found.to.line < found.from.line ||
    (found.to.line === found.from.line && found.to.column < found.from.column)
  ) {
    return null;
  }
  return {
    rule: found.code ?? source,
    origin: 'build',
    severity: found.severity,
    message: found.message,
    line: found.from.line + 1,
    column: found.from.column,
    endLine: found.to.line + 1,
    endColumn: found.to.column,
  };
};

/**
 * The library as the completion list wants it: a name, its signature and the
 * sentence beside it. `libraryHelp` is the one place that knows what a library
 * function is, and the editor is handed the answer rather than the table.
 */
const libraryFunctions = (): LibraryFunction[] =>
  libraryNames().flatMap((name: string) => {
    const entry = libraryHelp(name);
    return entry === null
      ? []
      : [
          {
            name,
            signature: entry.signature,
            description: entry.description,
          },
        ];
  });

/**
 * One open file. The session is what a tab remembers while the reader is
 * looking at another one: not only its text, but where the cursor was, which
 * lines were marked and what was pinned - the same record item 12 hands over,
 * used here to hold a tab between visits.
 */
interface OpenFile {
  path: string;
  text: string;
  session: SessionJSON | null;
}

export class EditorController {
  private readonly bus: Bus;
  private readonly client: InterpreterClient;
  private sourcecode: string;
  private readonly editor: PlivetEditor;
  private readonly tabs: TabBar;
  /** Every file open, in the order they were opened. */
  private files: OpenFile[];
  /** The file being edited, and the file that runs. Usually the same one. */
  private activePath: string;
  private entryPath: string;
  private readonly hover: HoverTextSource;
  /** Statement records for the entry file, independent of the visible tab. */
  private readonly statement: HoverTextSource;
  private readonly completions: ProgramCompletions;
  private isDebugging = false;
  /**
   * Whether the stop the canvas is showing is one a mark made, rather than a
   * step the reader took. Set from the interpreter's own run event and
   * cleared by every press that answers directly.
   */
  private stoppedAtBreakpoint = false;
  private fontSize: number;
  /**
   * The size the text returns to, which is the size it opened at: a host that
   * set one meant that one, and Reset that went to 14 would be a way out of
   * the page's own configuration rather than back to it.
   */
  private readonly defaultFontSize: number;
  /**
   * The three things the linter shows, kept apart because they arrive apart:
   * the parser answers on every edit, the teaching rules with it, and the run
   * answers on every step. The linter holds one set, so all three are handed
   * over together whenever any of them changes.
   */
  /**
   * The declarations the last syntax check found, kept because two things ask
   * about them from here: the tooltip hover, which is handed them, and the
   * modifier-hover link that goes to one.
   */
  private constructs: Construct[] = [];
  /**
   * What the preprocessor replaced, kept for the same reason as the
   * constructs: a macro use is a name the parser never saw, so the link that
   * goes to its `#define` has only this list to resolve it against.
   */
  private expansions: Expansion[] = [];
  /** The composed run's constructs, localized for whichever tab is visible. */
  private executionConstructs: Construct[] = [];
  /** The composed run's preprocessing map, localized whenever a tab opens. */
  private executionExpansions: Expansion[] = [];
  /**
   * What the background checker found, per file.
   *
   * A map rather than one file's arrays, because the findings table is meant
   * to tell a reader that the file they are *not* looking at is the broken
   * one. Each check answers about the tab it was asked about, so it replaces
   * that path's entry and leaves every other path alone: the answer about a
   * file nobody has touched is still the answer.
   */
  private readonly localFindings = new Map<string, FileFindings>();
  /**
   * What the rules that read the whole program found, per file.
   *
   * Kept apart from the local findings because it is invalidated differently:
   * these answer a question about every file at once, so a check replaces the
   * whole set rather than one path's entry.
   */
  private readonly programFindings = new Map<string, FileFindings>();
  private runtimeLints: TeachingDiagnostic[] = [];
  /** Source text already checked in each tab, to avoid parsing on every call. */
  private readonly checkedSources = new Map<string, string>();
  /** Parser errors found across all files before Start/Run was refused. */
  private readonly preflightErrors = new Map<string, SyntaxErrorModel[]>();
  /** Findings supplied by each host service, then by source path. */
  private readonly externalLints = new Map<
    string,
    Map<string, TeachingDiagnostic[]>
  >();
  private readonly sourceListeners = new Set<
    (snapshot: SourceSnapshot) => void
  >();
  private readonly activeFileListeners = new Set<(path: string) => void>();
  /** Latest interpreter arrival counts, by source file and one-based line. */
  private readonly breakpointHits = new Map<string, Map<number, number>>();
  private revision = 0;
  /** Prevent tab restoration and other internal document swaps becoming edits. */
  private suppressEditorChange = false;
  /** The quick visual pass and the deliberately quieter full parser pass. */
  private preprocessTimer: ReturnType<typeof setTimeout> | null = null;
  private syntaxCheckTimer: ReturnType<typeof setTimeout> | null = null;
  /** A quick answer arriving after the full one must not erase enum marks. */
  private fullExpansionResult: { revision: number; path: string } | null = null;

  constructor(mount: HTMLElement, options: EditorControllerOptions) {
    const {
      bus,
      client,
      dark = false,
      doc,
      files,
      entry,
      editableRegions = [],
      codeMirror,
      onSourceChange,
      onActiveFileChange,
    } = options;
    const settings = codeMirrorSettings(codeMirror);
    this.defaultFontSize = settings.fontSize ?? DEFAULT_FONT_SIZE;
    this.fontSize = this.defaultFontSize;
    this.bus = bus;
    this.client = client;
    if (typeof onSourceChange !== 'undefined') {
      this.sourceListeners.add(onSourceChange);
    }
    if (typeof onActiveFileChange !== 'undefined') {
      this.activeFileListeners.add(onActiveFileChange);
    }
    const defaults = defaultProgram();
    const useDefaults =
      typeof doc === 'undefined' &&
      (typeof files === 'undefined' || files.length === 0);
    const opened = useDefaults
      ? defaults.files.map((file) => ({ ...file, session: null }))
      : typeof files === 'undefined' || files.length === 0
        ? [
            {
              path: strings.savedFileName,
              text: doc ?? '',
              session: null,
            },
          ]
        : files.map((file) => ({ ...file, session: null }));
    const requestedEntry = entry ?? (useDefaults ? defaults.entry : undefined);
    this.files = opened;
    this.entryPath = entryPathFor(opened, requestedEntry);
    this.activePath = this.entryPath;
    this.sourcecode = this.fileAt(this.activePath).text;
    this.hover = new HoverTextSource();
    this.statement = new HoverTextSource();
    this.completions = new ProgramCompletions(libraryFunctions());

    // The strip goes above the editor, in the same box: the editor is what
    // the tabs are tabs of, and a bar anywhere else would be a bar for the
    // page rather than for this widget.
    this.tabs = new TabBar(mount, {
      onSelect: (path: string) => this.activate(path),
      onClose: (path: string) => this.closeFile(path),
      onEntry: (path: string) => this.setEntry(path),
    });

    this.editor = new PlivetEditor(mount, {
      ...settings,
      doc: this.sourcecode,
      dark,
      fontSize: this.fontSize,
      hoverText: this.hover.describe,
      onHoverObject: (object: string | null) =>
        this.bus.signal('focusObject', object, 'editor'),
      onWatchesChanged: () => this.showWatches(),
      onBreakpointsChanged: () => this.signalBreakpointsChanged(),
      declarationAt: (request: DeclarationRequest) =>
        this.declarationRange(request),
      completions: this.completions.source,
      onChange: (code: string) => this.edited(code),
    });

    if (editableRegions.length !== 0) {
      this.editor.debug.setEditableRegions(this.editor.view, editableRegions);
    }
    this.showTabs();

    this.bus.slot(
      'debug',
      (controlEvent: CONTROL_EVENT, stdinText?: string) => {
        this.send(controlEvent, stdinText);
      }
    );
    // A run stops on its own at the end of the program, at a read or at a
    // breakpoint, long after `StepAll` returned. The interpreter reports that
    // directly rather than through the bus: `src/core` may not know the
    // application exists.
    this.client.onRunEvent = (event: RUN_EVENT, response: Response) => {
      // Why the run stopped is knowable only here. A step that happens to
      // land on a marked line is not a breakpoint hit, so this is recorded
      // from what the interpreter reports rather than worked out afterwards
      // by looking the stopped line up in the breakpoint table.
      this.stoppedAtBreakpoint = event === 'Breakpoint';
      this.recieve(response);
    };
    // The other direction: the canvas says which object the pointer is over,
    // and the declaration of it is marked here. What the editor said itself
    // comes back through the same event and is ignored.
    this.bus.slot(
      'focusObject',
      (object: string | null, origin: 'editor' | 'graph') => {
        if (origin !== 'editor') {
          this.markDeclaration(object);
        }
      }
    );
    this.bus.slot('navigateMemory', (target: MemoryNavigationTarget) =>
      this.navigateFromMemory(target)
    );
    this.checkOnApproach();
    this.bus.slot('zoom', (command: ZOOM_COMMAND) => {
      if (command === 'In') {
        this.setFontSize(this.fontSize + 1);
      } else if (command === 'Out') {
        this.setFontSize(
          Math.max(
            this.fontSize - 1,
            Math.min(MINIMUM_FONT_SIZE, this.defaultFontSize)
          )
        );
      } else {
        this.setFontSize(this.defaultFontSize);
      }
    });
  }

  /**
   * The first syntax check, and when it happens.
   *
   * Everything the editor knows about the program comes from a check: the
   * construct tooltips, the completion of the program's own names, the
   * teaching rules, and the modifier-hover link that goes to a declaration.
   * Starting that check during construction makes an immediate Start wait
   * behind a complete background parse. Approaching the editor is the first
   * signal that source diagnostics are wanted, and normally gives the Worker
   * time to finish before the reader asks a tooltip or begins editing.
   */
  private checkOnApproach(): void {
    let checked = false;
    const check = () => {
      if (checked) {
        return;
      }
      checked = true;
      this.bus.signal('debug', 'Preprocess');
      this.bus.signal('debug', 'SyntaxCheck');
    };
    this.editor.view.dom.addEventListener('mouseenter', check);
    this.editor.view.dom.addEventListener('focusin', check);
  }

  setDark(dark: boolean): void {
    this.editor.setDark(dark);
  }

  /** The program as it stands, for whoever needs to read it rather than run it. */
  code(): string {
    return this.sourcecode;
  }

  /** The rendered file strip, used by adjacent controls for their placement. */
  get tabBarElement(): HTMLElement {
    return this.tabs.root;
  }

  /**
   * A program from outside: a file the reader opened, or a host handing over
   * a new one. The session is stopped first - the document is held while a
   * program runs - and checked afterwards, so the editor's marks belong to
   * the program that is now in it.
   */
  replaceCode(code: string): void {
    this.bus.signal('debug', 'Stop');
    this.withSuppressedEditorChange(() => this.editor.replaceCode(code));
    this.sourcecode = code;
    this.fileAt(this.activePath).text = code;
    this.sourceChanged();
    this.bus.signal('debug', 'SyntaxCheck');
  }

  /** Everything a saved session holds: the program and what is marked on it. */
  session(): SessionJSON {
    return this.editor.debug.session(this.editor.view.state);
  }

  /**
   * Puts one back. The interpreter is stopped first: the session being
   * restored is a program, and a running one is a different program with the
   * document held against edits.
   */
  restore(session: SessionJSON): void {
    this.bus.signal('debug', 'Stop');
    this.withSuppressedEditorChange(() =>
      this.editor.debug.restore(this.editor.view, session)
    );
    this.sourcecode = this.editor.getCode();
    this.fileAt(this.activePath).text = this.sourcecode;
    this.sourceChanged();
    this.bus.signal('debug', 'SyntaxCheck');
  }

  destroy(): void {
    this.cancelScheduledChecks();
    this.sourceListeners.clear();
    this.activeFileListeners.clear();
    this.tabs.destroy();
    this.editor.destroy();
  }

  /**
   * Every file open, and which of them runs. It is what a request carries and
   * what a host page would submit.
   */
  openFiles(): SourceFile[] {
    return this.files.map((file) =>
      file.path === this.activePath
        ? { path: file.path, text: this.sourcecode }
        : { path: file.path, text: file.text }
    );
  }

  /** The complete value a host compiles, saves or submits. */
  sourceSnapshot(): SourceSnapshot {
    return {
      files: this.openFiles(),
      entry: this.entryPath,
      active: this.activePath,
      revision: this.revision,
    };
  }

  onSourcesChanged(listener: (snapshot: SourceSnapshot) => void): Unsubscribe {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  }

  onActiveFileChanged(listener: (path: string) => void): Unsubscribe {
    this.activeFileListeners.add(listener);
    return () => this.activeFileListeners.delete(listener);
  }

  entry(): string {
    return this.entryPath;
  }

  active(): string {
    return this.activePath;
  }

  /**
   * Replace the complete source set with a host-provided version.
   * Invalid or empty file sets are refused without changing the editor.
   */
  updateFiles(files: SourceFile[], entry?: string): boolean {
    const paths = new Set<string>();
    if (files.length === 0) {
      return false;
    }
    for (const file of files) {
      if (
        typeof file.path !== 'string' ||
        file.path === '' ||
        typeof file.text !== 'string' ||
        paths.has(file.path)
      ) {
        return false;
      }
      paths.add(file.path);
    }
    this.bus.signal('debug', 'Stop');
    this.files = files.map((file) => ({ ...file, session: null }));
    this.entryPath = entryPathFor(this.files, entry);
    this.activePath = this.entryPath;
    this.sourcecode = this.fileAt(this.activePath).text;
    this.withSuppressedEditorChange(() => {
      this.editor.replaceCode(this.sourcecode);
      this.editor.debug.setBreakpointStates(this.editor.view, []);
    });
    this.clearLocalDiagnostics();
    this.showTabs();
    this.sourceChanged();
    this.signalActiveFileChanged();
    this.bus.signal('debug', 'SyntaxCheck');
    return true;
  }

  /**
   * Replace one host service's findings without disturbing any other source.
   * False means the result belonged to an obsolete source revision.
   */
  setExternalDiagnostics(
    source: string,
    diagnostics: ExternalDiagnostic[],
    options: DiagnosticOptions = {}
  ): boolean {
    if (
      source.trim() === '' ||
      (typeof options.revision !== 'undefined' &&
        options.revision !== this.revision)
    ) {
      return false;
    }
    const knownPaths = new Set(this.files.map((file) => file.path));
    const byPath = new Map<string, TeachingDiagnostic[]>();
    for (const found of diagnostics) {
      if (
        typeof found !== 'object' ||
        found === null ||
        typeof found.path !== 'string' ||
        typeof found.message !== 'string' ||
        !knownPaths.has(found.path)
      ) {
        continue;
      }
      const converted = externalDiagnostic(source, found);
      if (converted === null) {
        continue;
      }
      const previous = byPath.get(found.path) ?? [];
      previous.push(converted);
      byPath.set(found.path, previous);
    }
    this.externalLints.set(source, byPath);
    this.showDiagnostics();
    return true;
  }

  clearExternalDiagnostics(source: string): void {
    if (this.externalLints.delete(source)) {
      this.showDiagnostics();
    }
  }

  /**
   * A file from outside, opened beside the ones already there rather than
   * over them. A path that is already open is replaced and shown, which is
   * what re-opening a file a reader has edited means.
   */
  openInTab(path: string, text: string): void {
    const existing = this.files.find((file) => file.path === path);
    if (typeof existing === 'undefined') {
      this.files = this.files.concat({ path, text, session: null });
    } else {
      existing.text = text;
      existing.session = null;
    }
    this.activate(path, true);
    this.sourceChanged();
  }

  /**
   * Switches to a file. What the reader had in the one they are leaving -
   * the text, the cursor, the breakpoints, the pinned names - is kept as a
   * session and put back when they return, because a tab that forgot where
   * they were is a tab they have to find their place in twice.
   */
  private activate(path: string, force = false, syntaxCheck = true): void {
    if (path === this.activePath && !force) {
      return;
    }
    const leaving = this.files.find((file) => file.path === this.activePath);
    if (typeof leaving !== 'undefined') {
      leaving.text = this.sourcecode;
      leaving.session = this.session();
    }
    const arriving = this.fileAt(path);
    this.activePath = path;
    if (arriving.session === null) {
      this.withSuppressedEditorChange(() => {
        this.editor.replaceCode(arriving.text);
        this.editor.debug.setBreakpointStates(this.editor.view, []);
      });
    } else {
      this.withSuppressedEditorChange(() =>
        this.editor.debug.restore(this.editor.view, arriving.session!)
      );
    }
    this.sourcecode = this.editor.getCode();
    if (this.isDebugging) {
      this.showExecutionSourceFor(path);
    } else {
      this.constructs = [];
      this.hover.setConstructs([]);
      this.completions.setConstructs([]);
      this.setExpansions([]);
    }
    this.showTabs();
    this.showDiagnostics();
    this.signalActiveFileChanged();
    this.signalBreakpointsChanged();
    // A file that is not the one that runs has no marks of its own to show:
    // the parser is answering about the translation unit, and drawing its
    // findings over another file would be pointing at the wrong lines.
    if (syntaxCheck) {
      this.bus.signal('debug', 'SyntaxCheck');
    }
  }

  private setEntry(path: string): void {
    const file = this.files.find((candidate) => candidate.path === path);
    if (typeof file === 'undefined' || !canBeEntry(file)) {
      return;
    }
    this.entryPath = path;
    this.showTabs();
    // The program that runs has changed, so what the run and the checker said
    // about the old one is no longer about anything.
    this.bus.signal('debug', 'Stop');
    this.clearLocalDiagnostics();
    this.sourceChanged();
    this.bus.signal('debug', 'SyntaxCheck');
  }

  private closeFile(path: string): void {
    if (path === this.entryPath || this.files.length < 2) {
      return;
    }
    this.files = this.files.filter((file) => file.path !== path);
    if (this.activePath === path) {
      this.activate(this.entryPath, true);
    } else {
      this.showTabs();
    }
    this.sourceChanged();
  }

  private fileAt(path: string): OpenFile {
    const found = this.files.find((file) => file.path === path);
    return typeof found === 'undefined' ? this.files[0] : found;
  }

  private showTabs(): void {
    this.tabs.setTabs(
      this.files.map((file) => ({
        path: file.path,
        entry: file.path === this.entryPath,
        active: file.path === this.activePath,
        canBeEntry: canBeEntry(file),
      }))
    );
  }

  private setFontSize(fontSize: number) {
    this.fontSize = fontSize;
    this.editor.setFontSize(fontSize);
  }

  /**
   * Every edit. Preprocessor shading follows a short pause; parser diagnostics
   * keep their one-second quiet period because they do substantially more.
   */
  private edited(code: string) {
    this.sourcecode = code;
    this.fileAt(this.activePath).text = code;
    if (this.suppressEditorChange) {
      return;
    }
    this.sourceChanged();
    this.preprocessTimer = setTimeout(() => {
      if (code === this.sourcecode) {
        this.bus.signal('debug', 'Preprocess');
      }
    }, PREPROCESS_DELAY);
    this.syntaxCheckTimer = setTimeout(() => {
      if (code === this.sourcecode) {
        this.bus.signal('debug', 'SyntaxCheck');
      }
    }, SYNTAX_CHECK_DELAY);
  }

  private cancelScheduledChecks(): void {
    if (this.preprocessTimer !== null) {
      clearTimeout(this.preprocessTimer);
      this.preprocessTimer = null;
    }
    if (this.syntaxCheckTimer !== null) {
      clearTimeout(this.syntaxCheckTimer);
      this.syntaxCheckTimer = null;
    }
  }

  private withSuppressedEditorChange(run: () => void): void {
    this.suppressEditorChange = true;
    try {
      run();
    } finally {
      this.suppressEditorChange = false;
    }
  }

  /**
   * One source mutation invalidates every remote answer for the old revision.
   *
   * Every answer for *that file*, that is. The findings in a file the edit did
   * not touch still describe its text exactly, and dropping them would empty
   * the table on every keystroke and refill it a pause later - which is the
   * whole of what the reader would see of the files they are not editing.
   */
  private sourceChanged(changed: string = this.activePath): void {
    this.cancelScheduledChecks();
    // Entry eligibility depends on the current text: adding or removing a
    // `main` definition must add or remove the triangle immediately.
    this.showTabs();
    this.revision += 1;
    this.executionConstructs = [];
    this.executionExpansions = [];
    // Linker results for every file can change when any one file changes.
    this.checkedSources.clear();
    // What was found in the edited file is about text that no longer exists,
    // and its line numbers have already moved. A preflight refusal and the
    // background syntax error that duplicated it must both go with it;
    // otherwise clearing the refusal only reveals the stale background copy
    // until the delayed checker answers - and a refusal belongs to the run
    // that was refused, not to any one file, so the whole set goes.
    this.localFindings.delete(changed);
    this.programFindings.delete(changed);
    this.runtimeLints = [];
    this.breakpointHits.clear();
    this.preflightErrors.clear();
    this.externalLints.clear();
    this.bus.signal('runStatus', null);
    this.showDiagnostics();
    const snapshot = this.sourceSnapshot();
    for (const listener of this.sourceListeners) {
      listener(snapshot);
    }
    this.signalBreakpointsChanged();
  }

  private signalActiveFileChanged(): void {
    for (const listener of this.activeFileListeners) {
      listener(this.activePath);
    }
  }

  private clearLocalDiagnostics(): void {
    this.constructs = [];
    this.executionConstructs = [];
    this.executionExpansions = [];
    this.clearLocalFindings();
  }

  /**
   * Findings tied to one exact source revision, not editor source maps.
   *
   * Every file, unlike `sourceChanged`: this is for the cases where the
   * program itself is replaced - a new file set, a new entry - and nothing
   * that was said about the old one is about anything any more.
   */
  private clearLocalFindings(): void {
    this.localFindings.clear();
    this.programFindings.clear();
    this.runtimeLints = [];
    this.preflightErrors.clear();
  }

  send(controlEvent: CONTROL_EVENT, stdinText?: string) {
    const files = this.openFiles();
    const entry = this.fileAt(this.entryPath);
    const checkedPath = this.activePath;
    const request: Request = {
      // Older servers read this entry text. Current ones compose `files` and
      // use `entry` as the primary file and source-map origin.
      sourcecode:
        this.entryPath === this.activePath ? this.sourcecode : entry.text,
      controlEvent,
      stdinText,
      lineNumOfBreakpoint: this.breakpoints(),
      breakpoints: this.markedRows(),
      files,
      entry: this.entryPath,
      active: checkedPath,
    };
    if (controlEvent === 'Preprocess' || controlEvent === 'SyntaxCheck') {
      const requestRevision = this.revision;
      // The parser pass is the one a reader waits on: the preprocessor pass
      // is a tenth of a second and shades the source rather than reporting
      // anything. Only the check that produces findings reports that it is
      // running, and it reports that it has finished whatever it found -
      // including for an answer that has gone stale, because what the line is
      // saying is whether the checker is still working.
      const checking = controlEvent === 'SyntaxCheck';
      if (checking) {
        this.bus.signal('diagnosticActivity', 'localRunning');
      }
      this.client
        .send(request)
        .then((response: Response) => {
          if (checking) {
            this.bus.signal('diagnosticActivity', 'localComplete');
          }
          // A slower check for text that has since changed must not replace
          // the construct map delivered by Start for the program now running.
          const checkedFile = this.fileAt(checkedPath);
          const currentText =
            checkedPath === this.activePath
              ? this.sourcecode
              : checkedFile.text;
          if (
            response.sourcecode !== currentText ||
            checkedPath !== this.activePath ||
            requestRevision !== this.revision
          ) {
            return;
          }
          if (controlEvent === 'Preprocess') {
            if (
              this.fullExpansionResult?.revision === requestRevision &&
              this.fullExpansionResult.path === checkedPath
            ) {
              return;
            }
            if (typeof response.programExpansions !== 'undefined') {
              this.executionExpansions = response.programExpansions;
            }
            this.setExpansions(
              typeof response.programExpansions === 'undefined'
                ? (response.expansions ?? [])
                : this.localExecutionExpansions(checkedPath)
            );
            return;
          }
          this.fullExpansionResult = {
            revision: requestRevision,
            path: checkedPath,
          };
          this.checkedSources.set(checkedPath, currentText);
          const { expansions, constructs } = response;
          const seen = typeof constructs === 'undefined' ? [] : constructs;
          if (typeof response.programExpansions !== 'undefined') {
            this.executionExpansions = response.programExpansions;
          }
          if (typeof response.programConstructs !== 'undefined') {
            this.executionConstructs = response.programConstructs;
          }
          this.setCheckResult(checkedPath, response);
          if (this.isDebugging) {
            // A tab reached during a run uses the composed parser map, which
            // knows about declarations and macros from its header tabs.
            this.showExecutionSourceFor(checkedPath);
          } else {
            // What the modifier-hover link resolves a name against. It is kept
            // here rather than asked of the hover, because the hover is handed
            // the constructs and does not hand them back.
            this.constructs = seen;
            if (checkedPath === this.entryPath) {
              this.statement.setConstructs(seen);
            }
            this.setExpansions(
              typeof response.programExpansions === 'undefined'
                ? (expansions ?? [])
                : this.localExecutionExpansions(checkedPath)
            );
            this.hover.setConstructs(seen);
            this.completions.setConstructs(seen);
          }
        })
        .catch((e) => {
          if (checking) {
            this.bus.signal('diagnosticActivity', 'localComplete');
          }
          console.log(e);
          alert(e);
        });
      return;
    }
    this.client
      .send(request)
      .then((response: Response) => {
        // The answer to a press: a step the reader took, or the `Executing`
        // that a run answers with before it has stopped anywhere. Neither is
        // a breakpoint, whatever the last run ended on.
        this.stoppedAtBreakpoint = false;
        this.recieve(response);
      })
      .catch((e) => {
        this.bus.signal('runStatus', 'stoppedOnError');
        console.log(e);
        alert(e);
      });
  }

  /** Toggle the breakpoint on the line the editor's primary cursor is in. */
  toggleBreakpoint(): void {
    this.editor.debug.toggleBreakpoint(this.editor.view);
  }

  /** Every breakpoint in every tab, ready for the debugger table. */
  breakpointEntries(): BreakpointEntry[] {
    return this.files.flatMap((file) => {
      const states = this.breakpointStatesFor(file);
      const lines = (
        file.path === this.activePath ? this.sourcecode : file.text
      ).split('\n');
      const hits = this.breakpointHits.get(file.path);
      return states.map((breakpoint) => ({
        path: file.path,
        line: breakpoint.row + 1,
        enabled: breakpoint.enabled,
        statement: lines[breakpoint.row]?.trim() ?? '',
        hits: hits?.get(breakpoint.row + 1) ?? 0,
      }));
    });
  }

  setBreakpointEnabled(path: string, line: number, enabled: boolean): void {
    this.changeBreakpoint(path, line, (breakpoints, row) =>
      breakpoints.map((breakpoint) =>
        breakpoint.row === row ? { ...breakpoint, enabled } : breakpoint
      )
    );
  }

  removeBreakpoint(path: string, line: number): void {
    this.changeBreakpoint(path, line, (breakpoints, row) =>
      breakpoints.filter((breakpoint) => breakpoint.row !== row)
    );
  }

  setAllBreakpointsEnabled(enabled: boolean): void {
    for (const file of this.files) {
      const states = this.breakpointStatesFor(file).map((breakpoint) => ({
        ...breakpoint,
        enabled,
      }));
      this.storeBreakpointStates(file, states);
    }
    this.signalBreakpointsChanged();
  }

  /** Open a breakpoint's tab and place the editor selection on its line. */
  navigateToBreakpoint(path: string, line: number): void {
    if (!this.files.some((file) => file.path === path)) {
      return;
    }
    this.activate(path, false, false);
    const row = Math.max(Math.trunc(line) - 1, 0);
    goTo(this.editor.view, rowRange(this.editor.view.state.doc, row));
    this.editor.view.focus();
  }

  /** Breakpoints as the interpreter counts them: zero-based rows. */
  private breakpoints(): number[] {
    return this.editor.debug.rows(this.editor.view.state);
  }

  private breakpointStatesFor(file: OpenFile): BreakpointState[] {
    if (file.path === this.activePath) {
      return this.editor.debug.breakpoints(this.editor.view.state);
    }
    return [
      ...(file.session?.breakpoints ?? []).map((row) => ({
        row,
        enabled: true,
      })),
      ...(file.session?.disabledBreakpoints ?? []).map((row) => ({
        row,
        enabled: false,
      })),
    ].sort((left, right) => left.row - right.row);
  }

  private changeBreakpoint(
    path: string,
    line: number,
    change: (states: BreakpointState[], row: number) => BreakpointState[]
  ): void {
    const file = this.files.find((candidate) => candidate.path === path);
    const row = Math.trunc(line) - 1;
    if (typeof file === 'undefined' || row < 0) {
      return;
    }
    const states = this.breakpointStatesFor(file);
    if (!states.some((breakpoint) => breakpoint.row === row)) {
      return;
    }
    this.storeBreakpointStates(file, change(states, row));
    if (file.path !== this.activePath) {
      this.signalBreakpointsChanged();
    }
  }

  private storeBreakpointStates(
    file: OpenFile,
    states: BreakpointState[]
  ): void {
    if (file.path === this.activePath) {
      this.editor.debug.setBreakpointStates(this.editor.view, states);
      return;
    }
    if (file.session === null) {
      return;
    }
    file.session = {
      ...file.session,
      breakpoints: states
        .filter((breakpoint) => breakpoint.enabled)
        .map((breakpoint) => breakpoint.row),
      disabledBreakpoints: states
        .filter((breakpoint) => !breakpoint.enabled)
        .map((breakpoint) => breakpoint.row),
    };
  }

  private signalBreakpointsChanged(): void {
    this.bus.signal('breakpoints', this.breakpointEntries());
  }

  /**
   * Every marked row the reader has set, in every tab.
   *
   * A breakpoint belongs to the file it is in, and only the visible tab's
   * document holds live marks: the rest are in the session each tab was left
   * with. Sending the visible rows alone is what made a breakpoint in a
   * helper do nothing - it was never in the request, so the run had nothing
   * to stop for.
   */
  private markedRows(): FileBreakpoints[] {
    return this.files
      .map((file) => ({
        path: file.path,
        rows:
          file.path === this.activePath
            ? this.breakpoints()
            : (file.session?.breakpoints ?? []),
      }))
      .filter((file) => file.rows.length > 0);
  }

  recieve(response: Response) {
    try {
      const { debugState, model, output, step, runtime, coverage, location } =
        response;
      const fileErrors = response.fileErrors ?? [];
      const rejected = fileErrors.length !== 0;
      const stoppedOnError = runtime?.some((diagnostic) => diagnostic.fatal);
      const runStatus: RunStatus | undefined = rejected
        ? rejectionStatus(fileErrors, response.diagnosticPath)
        : stoppedOnError
          ? typeof location === 'undefined'
            ? 'stoppedOnError'
            : {
                kind: 'invalidStatement',
                path: location.path,
                line: location.range.begin.y,
              }
          : debugState === 'First' ||
              debugState === 'Executing' ||
              debugState === 'Stop'
            ? null
            : undefined;
      if (typeof runStatus !== 'undefined') {
        this.bus.signal('runStatus', runStatus);
      }
      if (rejected) {
        this.showPreflightErrors(fileErrors, response.diagnosticPath);
      } else if (debugState !== 'Stop') {
        this.preflightErrors.clear();
      }
      this.setDebugging(debugState !== 'Stop');
      if (debugState === 'Stop') {
        this.breakpointHits.clear();
      } else if (
        typeof location !== 'undefined' &&
        typeof coverage !== 'undefined'
      ) {
        this.breakpointHits.set(
          location.path,
          new Map(coverage.map((entry) => [entry.line, entry.count]))
        );
      }
      this.showSourceLocation(location, debugState);
      if (typeof response.constructs !== 'undefined') {
        this.executionConstructs = response.constructs;
        this.executionExpansions = response.expansions ?? [];
        this.showExecutionSourceFor(this.activePath);
      }
      const editorModel = this.editorStep(model, location);
      this.hover.setStep(editorModel);
      // The statement panel names the same file and line as the editor. The
      // interpreter model uses the composed translation unit, so handing that
      // model to the panel made every entry-file line include the number of
      // header lines placed before it.
      this.statement.setConstructs(this.constructs);
      this.statement.setStep(editorModel);
      this.showWatches();
      this.setRuntimeDiagnostics(typeof runtime === 'undefined' ? [] : runtime);
      this.editor.debug.showCoverage(
        this.editor.view,
        typeof coverage === 'undefined' ? [] : coverage
      );
      this.signalBreakpointsChanged();
      // Running suspends redraw, not the controls: Stop and Restart must be
      // enabled while the Worker is advancing through a long call or run.
      this.bus.signal(
        'changeState',
        debugState,
        step,
        this.debugPosition(debugState, location)
      );
      if (debugState === 'Executing') {
        return;
      }
      this.bus.signal('changeOutput', output);
      this.bus.signal(
        'draw',
        editorModel,
        this.statement.explainStatement(this.sourcecode)
      );
      this.setHighlightOnCode(debugState, editorModel);
    } catch (e) {
      console.log(e);
      alert(e);
    }
  }

  /**
   * Where a paused session is, for whoever reports what the debugger is doing.
   *
   * `location` is the interpreter's range already mapped back onto a visible
   * tab, which is the same file and line the editor highlights - so the
   * status line and the marked line cannot disagree. A stopped session has
   * nowhere to be, and a step the interpreter could not map back has nowhere
   * to send anyone, so both answer null.
   */
  private debugPosition(
    debugState: DEBUG_STATE,
    location: SourceLocation | undefined
  ): DebugPosition | null {
    if (debugState === 'Stop' || typeof location === 'undefined') {
      return null;
    }
    return {
      path: location.path,
      line: location.range.begin.y,
      atBreakpoint: this.stoppedAtBreakpoint,
    };
  }

  /**
   * A live session holds the document. The source the interpreter is running
   * cannot be edited out from under it, which is what the old modal existed to
   * argue about; stopping the session gives the document back.
   */
  private setDebugging(isDebugging: boolean) {
    if (isDebugging === this.isDebugging) {
      return;
    }
    this.isDebugging = isDebugging;
    this.editor.debug.setReadOnly(this.editor.view, isDebugging);
  }

  /** Refuse a malformed program and bring its first failing file into view. */
  private showPreflightErrors(
    found: FileSyntaxErrors[],
    firstPath: string | undefined
  ): void {
    this.preflightErrors.clear();
    for (const file of found) {
      this.preflightErrors.set(file.path, file.errors);
    }
    const path =
      typeof firstPath !== 'undefined' && this.preflightErrors.has(firstPath)
        ? firstPath
        : found[0].path;
    if (
      path !== this.activePath &&
      this.files.some((file) => file.path === path)
    ) {
      this.activate(path, false, false);
    } else {
      this.showDiagnostics();
    }
  }

  private showSourceLocation(
    location: SourceLocation | undefined,
    debugState: DEBUG_STATE
  ): void {
    // The interpreter can finish while its last retained expression is the
    // callee's return. There is no next expression to provide the caller's
    // range at EOF, but every frame has unwound, so leave the reader at the
    // entry/caller file rather than on a function that is no longer running.
    const path = debugState === 'EOF' ? this.entryPath : location?.path;
    if (
      typeof path === 'undefined' ||
      path === this.activePath ||
      !this.files.some((file) => file.path === path)
    ) {
      return;
    }
    // This is navigation, not an edit: preserve both tab sessions. The syntax
    // checker uses a throwaway interpreter, so checking a helper does not
    // disturb the Worker session that led us into it.
    this.activate(path, false, false);
    if (this.checkedSources.get(path) !== this.sourcecode) {
      this.bus.signal('debug', 'SyntaxCheck');
    }
  }

  /** Translate the composed interpreter model into the visible source tab. */
  private editorStep(
    model: StepModel,
    location: SourceLocation | undefined
  ): StepModel {
    if (typeof location === 'undefined' || model.codeRange === null) {
      return model;
    }
    const source = this.executionSource();
    const path = location.path;
    const codeRange = this.localParsedRange(source, path, model.codeRange);
    return {
      ...model,
      codeRange: codeRange ?? location.range,
      frames: model.frames.map((frame) => {
        if (frame.calledFrom === null) {
          return frame;
        }
        const caller = source.locate({
          begin: { x: 0, y: frame.calledFrom },
          end: { x: 0, y: frame.calledFrom },
        });
        return caller === null
          ? frame
          : {
              ...frame,
              calledFrom: caller.range.begin.y,
              calledFromFile: caller.path,
            };
      }),
      expression: this.localExpression(source, path, model.expression),
      callExpansions: model.callExpansions.flatMap((call) => {
        const expression = this.localExpression(source, path, call.expression);
        return expression === null ? [] : [{ ...call, expression }];
      }),
      constructStates: model.constructStates.flatMap((state) => {
        const range = this.localParsedRange(source, path, state.range);
        return range === null ? [] : [{ ...state, range }];
      }),
      evaluations: model.evaluations.flatMap((evaluation) => {
        const range = this.localParsedRange(source, path, evaluation.range);
        return range === null ? [] : [{ ...evaluation, range }];
      }),
    };
  }

  /** The current named source composed exactly as the Worker sees it. */
  private executionSource(): ExecutionSource {
    return new ExecutionSource(
      this.openFiles(),
      this.entryPath,
      this.fileAt(this.entryPath).text
    );
  }

  /** Put the run's source descriptions into one tab's coordinate system. */
  private showExecutionSourceFor(path: string): void {
    const source = this.executionSource();
    this.constructs = this.executionConstructs.flatMap((construct) => {
      const range = this.localParsedRange(source, path, {
        begin: { x: construct.column, y: construct.line },
        end: { x: construct.endColumn, y: construct.endLine },
      });
      if (range === null) {
        return [];
      }
      const clauses = construct.clauses?.map((clause) => {
        if (typeof clause.range === 'undefined') {
          return clause;
        }
        const local = this.localParsedRange(source, path, clause.range);
        return typeof local === 'undefined' || local === null
          ? { ...clause, range: undefined }
          : { ...clause, range: local };
      });
      const enclosing = construct.enclosing;
      const enclosingRange =
        typeof enclosing === 'undefined'
          ? null
          : this.localRange(source, path, {
              begin: { x: 0, y: enclosing.line },
              end: { x: 0, y: enclosing.line },
            });
      return [
        {
          ...construct,
          line: range.begin.y,
          column: range.begin.x,
          endLine: range.end.y,
          endColumn: range.end.x,
          ...(typeof clauses === 'undefined' ? {} : { clauses }),
          ...(typeof enclosing === 'undefined' || enclosingRange === null
            ? { enclosing: undefined }
            : {
                enclosing: {
                  ...enclosing,
                  line: enclosingRange.begin.y,
                },
              }),
        },
      ];
    });
    this.hover.setConstructs(this.constructs);
    this.completions.setConstructs(this.constructs);
    this.setExpansions(this.localExecutionExpansions(path));
  }

  /** Put the composed preprocessing map into one tab's coordinates. */
  private localExecutionExpansions(path: string): Expansion[] {
    const source = this.executionSource();
    return this.executionExpansions.flatMap((expansion) => {
      const range = this.localRange(source, path, {
        begin: { x: expansion.column, y: expansion.line },
        end: {
          x: expansion.column + expansion.length,
          y: expansion.line,
        },
      });
      if (range === null) {
        return [];
      }
      const definition =
        typeof expansion.definedAt === 'undefined'
          ? null
          : this.localRange(source, path, {
              begin: { x: 0, y: expansion.definedAt },
              end: { x: 0, y: expansion.definedAt },
            });
      return [
        {
          ...expansion,
          line: range.begin.y,
          column: range.begin.x,
          ...(definition === null
            ? { definedAt: undefined }
            : { definedAt: definition.begin.y }),
        },
      ];
    });
  }

  private localRange(
    source: ExecutionSource,
    path: string,
    range: CodeRangeModel
  ): CodeRangeModel | null {
    const location = source.locate(range);
    return location?.path === path ? location.range : null;
  }

  /** Map parser columns through macro replacement, then into one source tab. */
  private localParsedRange(
    source: ExecutionSource,
    path: string,
    range: CodeRangeModel
  ): CodeRangeModel | null {
    return this.localRange(
      source,
      path,
      originalRange(range, this.executionExpansions)
    );
  }

  private localExpression(
    source: ExecutionSource,
    path: string,
    expression: ExpressionModel | null
  ): ExpressionModel | null {
    if (expression === null) {
      return null;
    }
    const range = this.localParsedRange(source, path, expression.range);
    if (range === null) {
      return null;
    }
    const root = this.localExpressionNode(source, path, expression.root);
    return root === null ? null : { ...expression, range, root };
  }

  private localExpressionNode(
    source: ExecutionSource,
    path: string,
    node: ExpressionNodeModel
  ): ExpressionNodeModel | null {
    const range = this.localParsedRange(source, path, node.range);
    if (range === null) {
      return null;
    }
    return {
      ...node,
      range,
      children: node.children.flatMap((child) => {
        const local = this.localExpressionNode(source, path, child);
        return local === null ? [] : [local];
      }),
    };
  }

  setHighlightOnCode(debugState: DEBUG_STATE, model: StepModel) {
    if (debugState === 'Stop') {
      this.editor.debug.showStep(this.editor.view, null);
      return;
    }
    const { codeRange } = model;
    if (codeRange === null) {
      return;
    }
    // At end of file there is no statement left to point at, so the highlight
    // is cleared rather than left on the last one executed.
    if (debugState === 'EOF') {
      this.editor.debug.showStep(this.editor.view, null);
      return;
    }
    this.editor.debug.showStep(this.editor.view, {
      range: rangeOf(
        this.editor.view.state.doc,
        codeRange.begin.y,
        codeRange.begin.x,
        codeRange.end.y,
        codeRange.end.x
      ),
      values: model.inlineValues,
    });
  }

  /**
   * What the pinned names hold, as of the step just drawn.
   *
   * The editor holds which names are pinned - they are pinned to positions in
   * its document - and this side holds what a name is worth, so the values
   * are pushed in rather than looked up by the editor.
   */
  private showWatches() {
    const names = this.editor.debug.watches(this.editor.view.state);
    this.editor.debug.showWatches(
      this.editor.view,
      names.map((name) => ({ name, record: this.hover.watchRecord(name) }))
    );
  }

  /**
   * Where the name under a declaration-navigation gesture was declared.
   *
   * The constructs are the ones the last syntax check produced, so a program
   * that has not been checked - or one that does not parse - has nowhere to
   * send the reader, and the click stays a click. What the name refers to is
   * `declarations.ts`; what is added here is the conversion into the
   * document's own offsets, which is the editor's coordinate system and not
   * the interpreter's.
   */
  private declarationRange(request: DeclarationRequest) {
    const included = this.includedFile(request);
    if (included !== null && included.path !== this.activePath) {
      return {
        navigate: () => {
          this.activate(included.path);
          const first = this.editor.view.state.doc.line(1);
          goTo(this.editor.view, { from: first.from, to: first.to });
        },
      };
    }
    // Macros are asked about first, and not through the constructs at all: the
    // preprocessor replaced the name before the parser read the line, so the
    // one record of where `LIMIT` came from is the expansion list.
    const defined = macroDefinitionLine(this.expansions, request);
    if (defined !== null) {
      return this.macroNameRange(defined, request.word);
    }
    // A composed expansion retains the definition's global line even when it
    // lives in another tab. Resolve both ends through the execution source,
    // then let the editor gesture ask this controller to reveal that tab.
    const source = this.executionSource();
    const globalLine = source.globalLine(this.activePath, request.line);
    if (globalLine !== null) {
      const globalDefinition = macroDefinitionLine(this.executionExpansions, {
        ...request,
        line: globalLine,
      });
      const location =
        globalDefinition === null
          ? null
          : source.locate({
              begin: { x: 0, y: globalDefinition },
              end: { x: 0, y: globalDefinition },
            });
      if (location !== null) {
        if (location.path === this.activePath) {
          return this.macroNameRange(location.range.begin.y, request.word);
        }
        const { path, range } = location;
        const name = request.word;
        return {
          navigate: () => {
            this.activate(path);
            goTo(this.editor.view, this.macroNameRange(range.begin.y, name));
          },
        };
      }
    }
    // Resolve against the complete translation unit first. Besides finding
    // declarations from headers, this lets a call skip a local prototype and
    // reach the body in another source tab.
    if (globalLine !== null && this.executionConstructs.length !== 0) {
      const programDeclaration = declarationFor(this.executionConstructs, {
        ...request,
        line: globalLine,
      });
      const declarationLocation =
        programDeclaration === null
          ? null
          : source.locate({
              begin: {
                x: programDeclaration.column,
                y: programDeclaration.line,
              },
              end: {
                x: programDeclaration.endColumn,
                y: programDeclaration.endLine,
              },
            });
      if (declarationLocation !== null) {
        const declarationRange = declarationLocation.range;
        if (declarationLocation.path === this.activePath) {
          return rangeOf(
            this.editor.view.state.doc,
            declarationRange.begin.y,
            declarationRange.begin.x,
            declarationRange.end.y,
            declarationRange.end.x
          );
        }
        const declarationPath = declarationLocation.path;
        return {
          navigate: () => {
            this.activate(declarationPath);
            goTo(
              this.editor.view,
              rangeOf(
                this.editor.view.state.doc,
                declarationRange.begin.y,
                declarationRange.begin.x,
                declarationRange.end.y,
                declarationRange.end.x
              )
            );
          },
        };
      }
    }

    const found = declarationFor(this.constructs, request);
    return found === null
      ? null
      : rangeOf(
          this.editor.view.state.doc,
          found.line,
          found.column,
          found.endLine,
          found.endColumn
        );
  }

  /** An open source file named by the #include under this request. */
  private includedFile(request: DeclarationRequest): OpenFile | null {
    const doc = this.editor.view.state.doc;
    if (request.line < 1 || doc.lines < request.line) {
      return null;
    }
    const text = doc.line(request.line).text;
    const include = /^\s*#\s*include\s*[<"]([^>"]+)[>"]/.exec(text);
    if (include === null) {
      return null;
    }
    const name = include[1];
    const begin = include[0].indexOf(name);
    if (request.column < begin || begin + name.length <= request.column) {
      return null;
    }
    const directory = this.activePath.replace(/[^/]*$/, '');
    const candidates = new Set([name, this.normalizedPath(directory + name)]);
    return (
      this.files.find((file) =>
        candidates.has(this.normalizedPath(file.path))
      ) ?? null
    );
  }

  /** Collapse `.` and `..` segments without depending on a server-side path API. */
  private normalizedPath(path: string): string {
    const segments: string[] = [];
    for (const segment of path.replace(/\\/g, '/').split('/')) {
      if (segment === '' || segment === '.') {
        continue;
      }
      if (segment === '..') {
        segments.pop();
      } else {
        segments.push(segment);
      }
    }
    return segments.join('/');
  }

  /**
   * The macro's name on the `#define` line that defines it.
   *
   * The preprocessor records which line defined a macro and not which column,
   * so the name is found in the line itself. Marking the name rather than the
   * whole directive is what the jump elsewhere does - a reader who followed
   * `LIMIT` is shown `LIMIT`, with its replacement beside it - and the whole
   * line is the fallback for a `#define` the document no longer holds in the
   * shape it was read in.
   */
  private macroNameRange(line: number, name: string) {
    const doc = this.editor.view.state.doc;
    const found = doc.line(Math.min(Math.max(line, 1), doc.lines));
    // The name is an identifier - it matched a word in the editor to get here -
    // so it needs no escaping, only whole-word anchoring, or `MAX` would be
    // found inside `MAXIMUM`.
    const at = found.text.search(new RegExp(`\\b${name}\\b`));
    return at < 0
      ? { from: found.from, to: found.to }
      : { from: found.from + at, to: found.from + at + name.length };
  }

  /**
   * Marks where an object was declared, or takes the mark off.
   *
   * Which object the canvas means is a key its cells carry; which variable
   * that is, and where its declarator is written, are two questions the
   * application can answer and the canvas cannot.
   */
  private markDeclaration(object: string | null) {
    if (object === null) {
      this.editor.debug.showFocus(this.editor.view, null);
      return;
    }
    const declaration = this.hover.declarationOf(object);
    if (declaration === null) {
      this.editor.debug.showFocus(this.editor.view, null);
      return;
    }
    this.editor.debug.showFocus(
      this.editor.view,
      rangeOf(
        this.editor.view.state.doc,
        declaration.line,
        declaration.column,
        declaration.endLine,
        declaration.endColumn
      )
    );
  }

  /** Reveal the declaration represented by a double-clicked memory row. */
  private navigateFromMemory(target: MemoryNavigationTarget): void {
    if (target.kind === 'location') {
      this.navigateToLocation(target.path, target.line, target.column);
      return;
    }
    const executionConstructs =
      this.executionConstructs.length === 0
        ? this.constructs
        : this.executionConstructs;
    const declaration =
      target.kind === 'function'
        ? functionDefinitionFor(executionConstructs, target.name)
        : this.statement.declarationOf(target.key);
    if (declaration === null) {
      return;
    }
    const source = new ExecutionSource(
      this.openFiles(),
      this.entryPath,
      this.fileAt(this.entryPath).text
    );
    // Object declarations come from `this.statement`, whose construct list is
    // deliberately localized to the active tab for editor highlighting.
    // Function declarations above come from the worker's composed source.
    // Convert the former back to composed coordinates before asking the source
    // map to locate it; otherwise a header offset is subtracted twice.
    const declarationRange =
      target.kind === 'object'
        ? {
            begin: {
              x: declaration.column,
              y:
                source.globalLine(this.activePath, declaration.line) ??
                declaration.line,
            },
            end: {
              x: declaration.endColumn,
              y:
                source.globalLine(this.activePath, declaration.endLine) ??
                declaration.endLine,
            },
          }
        : {
            begin: { x: declaration.column, y: declaration.line },
            end: {
              x: declaration.endColumn,
              y: declaration.endLine,
            },
          };
    const location = source.locate({
      begin: declarationRange.begin,
      end: declarationRange.end,
    });
    if (location === null) {
      return;
    }
    if (location.path !== this.activePath) {
      this.activate(location.path, false, false);
    }
    goTo(
      this.editor.view,
      rangeOf(
        this.editor.view.state.doc,
        location.range.begin.y,
        location.range.begin.x,
        location.range.end.y,
        location.range.end.x
      )
    );
  }

  /**
   * A place in a file, opened and shown.
   *
   * This is what a diagnostic row asks for, and it asks for a position rather
   * than a declaration: the checker already knows where it looked, so nothing
   * has to be resolved, and the file it names is one of the open tabs or it is
   * not one this window can show at all.
   *
   * The whole line is what gets marked. A finding names the token the checker
   * stopped at, and a caret on that one character is easy to lose in a line a
   * reader has just been sent to from another panel.
   */
  private navigateToLocation(path: string, line: number, column: number): void {
    if (!this.files.some((file) => file.path === path)) {
      return;
    }
    if (path !== this.activePath) {
      this.activate(path, false, false);
    }
    const { doc } = this.editor.view.state;
    const row = rowRange(doc, Math.max(line - 1, 0));
    goTo(this.editor.view, {
      from: offsetAt(doc, line, column),
      to: row.to,
    });
  }

  setExpansions(expansions: Expansion[]) {
    this.expansions = expansions;
    this.hover.setExpansions(expansions);
    this.editor.debug.showExpansions(this.editor.view, expansions);
  }

  /**
   * Everything one check answered, in one call: what the parser refused in the
   * file it read, what the teaching rules found there, and what the rules that
   * read the whole program found in every file.
   *
   * One call because the linter holds one set of diagnostics, and two calls
   * would mean each replacing the other. The two halves are stored apart
   * because they go stale differently - see `localFindings`.
   */
  private setCheckResult(path: string, response: Response): void {
    this.localFindings.set(path, {
      errors: response.errors,
      lints: (response.lints ?? []).map(withLibraryHelp),
    });
    this.setProgramFindings(
      response.programErrors ?? [],
      response.programLints ?? []
    );
    this.showDiagnostics();
  }

  /**
   * The whole-program half, replaced as one set.
   *
   * Per path it would be wrong: an edit in `main.c` can answer a question
   * about `tour.h` - defining a function the header declared - and merging
   * would leave the answered one standing until somebody opened that file.
   */
  private setProgramFindings(
    errors: FileSyntaxErrors[],
    lints: FileLints[]
  ): void {
    this.programFindings.clear();
    const findings = (path: string): FileFindings => {
      const found = this.programFindings.get(path) ?? { errors: [], lints: [] };
      this.programFindings.set(path, found);
      return found;
    };
    for (const file of errors) {
      findings(file.path).errors.push(...file.errors);
    }
    for (const file of lints) {
      findings(file.path).lints.push(...file.lints.map(withLibraryHelp));
    }
  }

  /**
   * What the run has said so far, replacing what it said before. A stopped
   * session says nothing, which is what takes the marks off; a response that
   * adds nothing to an empty list leaves the linter alone rather than
   * dispatching a transaction per step.
   */
  private setRuntimeDiagnostics(found: RuntimeDiagnosticModel[]) {
    if (found.length === 0 && this.runtimeLints.length === 0) {
      return;
    }
    this.runtimeLints = found.map(asDiagnostic);
    this.showDiagnostics();
  }

  private showDiagnostics() {
    const external = Array.from(this.externalLints.values()).flatMap(
      (byPath) => byPath.get(this.activePath) ?? []
    );
    const showsRuntime = this.activePath === this.entryPath;
    const local = this.localFindings.get(this.activePath);
    const program = this.programFindings.get(this.activePath);
    this.editor.debug.showDiagnostics(
      this.editor.view,
      this.errorsIn(this.activePath),
      (local?.lints ?? [])
        .concat(program?.lints ?? [])
        .concat(showsRuntime ? this.runtimeLints : [])
        .concat(external)
    );
    this.bus.signal('diagnostics', this.collectedDiagnostics());
  }

  /**
   * The parser errors to show for one file, from whichever parse read it last.
   *
   * Three parses can have something to say about the same file and they must
   * not all say it: a refused start, the background check of that tab, and the
   * composed parse that every check runs. A refusal wins - it is the answer
   * about the program the reader just tried to run. The tab's own parse comes
   * next, because its coordinates are the file's own and its message was
   * written about the file alone. The composed parse is what is left, and it
   * is not nothing: a file can parse by itself and fail to parse after the
   * header it includes has been over it, and that error has nowhere else to
   * be reported.
   */
  private errorsIn(path: string): SyntaxErrorModel[] {
    const refused = this.preflightErrors.get(path);
    if (typeof refused !== 'undefined') {
      return refused;
    }
    const local = this.localFindings.get(path)?.errors ?? [];
    return local.length === 0
      ? (this.programFindings.get(path)?.errors ?? [])
      : local;
  }

  /**
   * Every finding the two checkers hold, for every file rather than for the
   * tab in front of the reader.
   *
   * The editor's own marks are per-tab and have to be: a gutter can only mark
   * the document it is beside. The table over the canvas is the other half of
   * that - it is where a reader finds out that the file they are not looking
   * at is the one the compiler refused - so it is built from the whole of what
   * is held here, and each finding keeps the name of the file it came from.
   *
   * Which parse's errors a file is shown is `errorsIn`'s question, and the
   * answer is the same one the gutter gets: they are parses of the same text,
   * and drawing two of them would report every error twice.
   */
  /** Every file anything is currently held about, named once each. */
  private knownPaths(): string[] {
    return Array.from(
      new Set([
        ...this.preflightErrors.keys(),
        ...this.localFindings.keys(),
        ...this.programFindings.keys(),
      ])
    );
  }

  private collectedDiagnostics(): DiagnosticEntry[] {
    const entries: DiagnosticEntry[] = [];
    const syntax = (
      path: string,
      errors: SyntaxErrorModel[]
    ): DiagnosticEntry[] =>
      errors.map((error) => ({
        severity: 'error' as const,
        origin: 'local' as const,
        path,
        line: error.line,
        column: error.charPositionInLine,
        message: error.msg,
      }));
    const teaching = (
      path: string,
      origin: DiagnosticEntry['origin'],
      lints: TeachingDiagnostic[]
    ): DiagnosticEntry[] =>
      lints.map((lint) => ({
        severity: lint.severity,
        origin,
        path,
        line: lint.line,
        column: lint.column,
        message: lint.message,
        rule: lint.rule,
      }));

    for (const path of this.knownPaths()) {
      entries.push(...syntax(path, this.errorsIn(path)));
      entries.push(
        ...teaching(path, 'local', this.localFindings.get(path)?.lints ?? []),
        ...teaching(path, 'local', this.programFindings.get(path)?.lints ?? [])
      );
    }
    entries.push(...teaching(this.entryPath, 'local', this.runtimeLints));
    for (const byPath of this.externalLints.values()) {
      for (const [path, lints] of byPath) {
        entries.push(...teaching(path, 'build', lints));
      }
    }
    return entries;
  }
}
