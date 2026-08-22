import {
  Request,
  SourceFile,
  CONTROL_EVENT,
  InterpreterClient,
  LintDiagnosticModel,
  Response,
  RuntimeDiagnosticModel,
  DEBUG_STATE,
  CodeRangeModel,
  ExecutionSource,
  ExpressionModel,
  ExpressionNodeModel,
  FileSyntaxErrors,
  StepModel,
  SourceLocation,
  SyntaxErrorModel,
} from '../core';
import strings from '../strings';
import { defaultProgram } from '../defaultProgram';
import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';
import {
  DeclarationRequest,
  EditableRegion,
  LibraryFunction,
  SessionJSON,
  containsMainDefinition,
  PlivetEditor,
  ProgramCompletions,
  goTo,
  rangeOf,
  TeachingDiagnostic,
} from '../ui/editor';
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
import type { MemoryNavigationTarget } from '../ui/graph';
import type {
  DiagnosticOptions,
  ExternalDiagnostic,
  SourceSnapshot,
  Unsubscribe,
} from './host';

const HEADER_EXTENSION = /\.(?:h|hh|hpp|hxx|h\+\+)$/i;
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
 * `Editor.tsx`, and it is the wiring between the two; what Phase 9 deleted was
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
  /** Reports a complete immutable snapshot after any source change. */
  onSourceChange?: (snapshot: SourceSnapshot) => void;
  /** Reports tab changes, which do not themselves change the source revision. */
  onActiveFileChange?: (path: string) => void;
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
  private fontSize = 14;
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
  private syntaxErrors: SyntaxErrorModel[] = [];
  private teachingLints: TeachingDiagnostic[] = [];
  /** The tab whose parser and teaching diagnostics these arrays describe. */
  private localDiagnosticsPath: string | null = null;
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
      onSourceChange,
      onActiveFileChange,
    } = options;
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
      doc: this.sourcecode,
      dark,
      fontSize: this.fontSize,
      hoverText: this.hover.describe,
      onHoverObject: (object: string | null) =>
        this.bus.signal('focusObject', object, 'editor'),
      onWatchesChanged: () => this.showWatches(),
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
    this.client.onRunEvent = (_event, response: Response) => {
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
        this.setFontSize(Math.max(this.fontSize - 1, 10));
      } else {
        this.setFontSize(14);
      }
    });
  }

  /**
   * The first syntax check, and when it happens.
   *
   * Everything the editor knows about the program comes from a check: the
   * construct tooltips, the completion of the program's own names, the
   * teaching rules, and the modifier-hover link that goes to a declaration.
   * Until now the first one ran a second after the first edit, so all four were dead on
   * a program the reader had opened and not yet typed into - which is exactly
   * the program a reader is most likely to be asking questions about.
   *
   * It is not run on construction either. The interpreter client starts its
   * Worker on the first command on purpose, so that a page holding several
   * PLIVETs pays for the ones somebody uses; checking from the constructor
   * would spawn a Worker and load the parser chunk for every instance on the
   * page. Coming near the editor - the pointer entering it, or the focus
   * arriving from a keyboard - is the first moment that says this instance is
   * the one being used, and it comes before the click that asks a question.
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
    this.withSuppressedEditorChange(() =>
      this.editor.replaceCode(this.sourcecode)
    );
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
      this.withSuppressedEditorChange(() =>
        this.editor.replaceCode(arriving.text)
      );
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

  /** One source mutation invalidates every remote answer for the old revision. */
  private sourceChanged(): void {
    this.cancelScheduledChecks();
    // Entry eligibility depends on the current text: adding or removing a
    // `main` definition must add or remove the triangle immediately.
    this.showTabs();
    this.revision += 1;
    this.executionConstructs = [];
    this.executionExpansions = [];
    // Linker results for every file can change when any one file changes.
    this.checkedSources.clear();
    this.preflightErrors.clear();
    this.externalLints.clear();
    this.showDiagnostics();
    const snapshot = this.sourceSnapshot();
    for (const listener of this.sourceListeners) {
      listener(snapshot);
    }
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
    this.syntaxErrors = [];
    this.teachingLints = [];
    this.localDiagnosticsPath = null;
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
      files,
      entry: this.entryPath,
      active: checkedPath,
    };
    if (controlEvent === 'Preprocess' || controlEvent === 'SyntaxCheck') {
      const requestRevision = this.revision;
      this.client
        .send(request)
        .then((response: Response) => {
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
          const { errors, expansions, constructs, lints } = response;
          const seen = typeof constructs === 'undefined' ? [] : constructs;
          if (typeof response.programExpansions !== 'undefined') {
            this.executionExpansions = response.programExpansions;
          }
          if (typeof response.programConstructs !== 'undefined') {
            this.executionConstructs = response.programConstructs;
          }
          this.localDiagnosticsPath = checkedPath;
          this.setSyntaxError(
            errors,
            typeof lints === 'undefined' ? [] : lints
          );
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
          console.log(e);
          alert(e);
        });
      return;
    }
    this.client
      .send(request)
      .then((response: Response) => {
        this.recieve(response);
      })
      .catch((e) => {
        console.log(e);
        alert(e);
      });
  }

  /** Toggle the breakpoint on the line the editor's primary cursor is in. */
  toggleBreakpoint(): void {
    this.editor.debug.toggleBreakpoint(this.editor.view);
  }

  /** Breakpoints as the interpreter counts them: zero-based rows. */
  private breakpoints(): number[] {
    return this.editor.debug.rows(this.editor.view.state);
  }

  recieve(response: Response) {
    try {
      const { debugState, model, output, step, runtime, coverage, location } =
        response;
      if (
        typeof response.fileErrors !== 'undefined' &&
        response.fileErrors.length !== 0
      ) {
        this.showPreflightErrors(response.fileErrors, response.diagnosticPath);
      } else if (debugState !== 'Stop') {
        this.preflightErrors.clear();
      }
      this.setDebugging(debugState !== 'Stop');
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
      // Running suspends redraw, not the controls: Stop and Restart must be
      // enabled while the Worker is advancing through a long call or run.
      this.bus.signal('changeState', debugState, step);
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
    if (
      typeof location === 'undefined' ||
      model.codeRange === null ||
      model.codeRange.begin.y === location.range.begin.y
    ) {
      return model;
    }
    const source = this.executionSource();
    const path = location.path;
    return {
      ...model,
      codeRange: location.range,
      expression: this.localExpression(source, path, model.expression),
      constructStates: model.constructStates.flatMap((state) => {
        const range = this.localRange(source, path, state.range);
        return range === null ? [] : [{ ...state, range }];
      }),
      evaluations: model.evaluations.flatMap((evaluation) => {
        const range = this.localRange(source, path, evaluation.range);
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
      const range = this.localRange(source, path, {
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
        const local = this.localRange(source, path, clause.range);
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

  private localExpression(
    source: ExecutionSource,
    path: string,
    expression: ExpressionModel | null
  ): ExpressionModel | null {
    if (expression === null) {
      return null;
    }
    const range = this.localRange(source, path, expression.range);
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
    const range = this.localRange(source, path, node.range);
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
    const location = source.locate({
      begin: { x: declaration.column, y: declaration.line },
      end: { x: declaration.endColumn, y: declaration.endLine },
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

  setExpansions(expansions: Expansion[]) {
    this.expansions = expansions;
    this.hover.setExpansions(expansions);
    this.editor.debug.showExpansions(this.editor.view, expansions);
  }

  /**
   * What the parser refused and what the teaching rules found, in one call:
   * the linter holds one set of diagnostics, and two calls would mean each
   * replacing the other.
   */
  setSyntaxError(
    errors: SyntaxErrorModel[],
    lints: LintDiagnosticModel[] = []
  ) {
    this.syntaxErrors = errors;
    this.teachingLints = lints.map(withLibraryHelp);
    this.showDiagnostics();
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
    const showsLocal = this.activePath === this.localDiagnosticsPath;
    const showsRuntime = this.activePath === this.entryPath;
    const refused = this.preflightErrors.get(this.activePath);
    this.editor.debug.showDiagnostics(
      this.editor.view,
      refused ?? (showsLocal ? this.syntaxErrors : []),
      (showsLocal ? this.teachingLints : [])
        .concat(showsRuntime ? this.runtimeLints : [])
        .concat(external)
    );
  }
}
