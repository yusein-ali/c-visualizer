import {
  Request,
  SourceFile,
  CONTROL_EVENT,
  InterpreterClient,
  LintDiagnosticModel,
  Response,
  RuntimeDiagnosticModel,
  DEBUG_STATE,
  StepModel,
  SyntaxErrorModel,
} from '../core';
import strings from '../strings';
import { Construct } from '../interpreter/Construct';
import { Expansion } from '../interpreter/Expansion';
import {
  DeclarationRequest,
  EditableRegion,
  LibraryFunction,
  SessionJSON,
  PlivetEditor,
  ProgramCompletions,
  rangeOf,
  TeachingDiagnostic,
} from '../ui/editor';
import { declarationFor } from './declarations';
import { HoverTextSource } from './hoverText';
import { libraryHelp, libraryNames } from './libraryHelp';
import { Bus } from './emitter';
import { TabBar } from '../ui/tabs';
import type { ZOOM_COMMAND } from '../ui/controls';

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
   * about them from here: the hover, which is handed them, and the ctrl-click
   * that goes to one.
   */
  private constructs: Construct[] = [];
  private syntaxErrors: SyntaxErrorModel[] = [];
  private teachingLints: TeachingDiagnostic[] = [];
  private runtimeLints: TeachingDiagnostic[] = [];

  constructor(mount: HTMLElement, options: EditorControllerOptions) {
    const {
      bus,
      client,
      dark = false,
      doc = strings.sourceCode,
      files,
      entry,
      editableRegions = [],
    } = options;
    this.bus = bus;
    this.client = client;
    const opened =
      typeof files === 'undefined' || files.length === 0
        ? [{ path: strings.savedFileName, text: doc, session: null }]
        : files.map((file) => ({ ...file, session: null }));
    this.files = opened;
    this.entryPath =
      typeof entry !== 'undefined' && opened.some((file) => file.path === entry)
        ? entry
        : opened[0].path;
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
   * teaching rules, and the ctrl-click that goes to a declaration. Until now
   * the first one ran a second after the first edit, so all four were dead on
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

  /**
   * A program from outside: a file the reader opened, or a host handing over
   * a new one. The session is stopped first - the document is held while a
   * program runs - and checked afterwards, so the editor's marks belong to
   * the program that is now in it.
   */
  replaceCode(code: string): void {
    this.bus.signal('debug', 'Stop');
    this.editor.replaceCode(code);
    this.sourcecode = code;
    this.fileAt(this.activePath).text = code;
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
    this.editor.debug.restore(this.editor.view, session);
    this.sourcecode = this.editor.getCode();
    this.bus.signal('debug', 'SyntaxCheck');
  }

  destroy(): void {
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

  entry(): string {
    return this.entryPath;
  }

  active(): string {
    return this.activePath;
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
  }

  /**
   * Switches to a file. What the reader had in the one they are leaving -
   * the text, the cursor, the breakpoints, the pinned names - is kept as a
   * session and put back when they return, because a tab that forgot where
   * they were is a tab they have to find their place in twice.
   */
  private activate(path: string, force = false): void {
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
      this.editor.replaceCode(arriving.text);
    } else {
      this.editor.debug.restore(this.editor.view, arriving.session);
    }
    this.sourcecode = this.editor.getCode();
    this.showTabs();
    // A file that is not the one that runs has no marks of its own to show:
    // the parser is answering about the translation unit, and drawing its
    // findings over another file would be pointing at the wrong lines.
    this.bus.signal('debug', 'SyntaxCheck');
  }

  private setEntry(path: string): void {
    this.entryPath = path;
    this.showTabs();
    // The program that runs has changed, so what the run and the checker said
    // about the old one is no longer about anything.
    this.bus.signal('debug', 'Stop');
    this.bus.signal('debug', 'SyntaxCheck');
  }

  private closeFile(path: string): void {
    if (path === this.entryPath || this.files.length < 2) {
      return;
    }
    this.files = this.files.filter((file) => file.path !== path);
    if (this.activePath === path) {
      this.activate(this.entryPath, true);
      return;
    }
    this.showTabs();
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
      }))
    );
  }

  private setFontSize(fontSize: number) {
    this.fontSize = fontSize;
    this.editor.setFontSize(fontSize);
  }

  /** Every edit, with the syntax check that follows a second of quiet. */
  private edited(code: string) {
    this.sourcecode = code;
    this.fileAt(this.activePath).text = code;
    setTimeout(() => {
      if (code === this.sourcecode) {
        this.bus.signal('debug', 'SyntaxCheck');
      }
    }, 1000);
  }

  send(controlEvent: CONTROL_EVENT, stdinText?: string) {
    const files = this.openFiles();
    const entry = this.fileAt(this.entryPath);
    const request: Request = {
      // The text that runs is the entry's, whichever tab is on the screen.
      sourcecode:
        this.entryPath === this.activePath ? this.sourcecode : entry.text,
      controlEvent,
      stdinText,
      lineNumOfBreakpoint: this.breakpoints(),
      files,
      entry: this.entryPath,
    };
    if (controlEvent === 'SyntaxCheck') {
      this.client
        .send(request)
        .then((response: Response) => {
          // A slower check for text that has since changed must not replace
          // the construct map delivered by Start for the program now running.
          const currentEntry = this.fileAt(this.entryPath);
          const currentEntryText =
            this.entryPath === this.activePath
              ? this.sourcecode
              : currentEntry.text;
          if (response.sourcecode !== currentEntryText) {
            return;
          }
          const { errors, expansions, constructs, lints } = response;
          const seen = typeof constructs === 'undefined' ? [] : constructs;
          // What the ctrl-click resolves a name against. It is kept here
          // rather than asked of the hover, because the hover is handed the
          // constructs and does not hand them back.
          this.constructs = seen;
          // The canvas always explains the entry file, even while another tab
          // is visible. Its syntax map must therefore not be cleared below.
          this.statement.setConstructs(seen);
          // What the parser found is about the translation unit. While the
          // reader is looking at another file, the marks come off rather than
          // land on lines they are not about.
          if (this.entryPath !== this.activePath) {
            this.constructs = [];
            this.setSyntaxError([], []);
            this.setExpansions([]);
            this.hover.setConstructs([]);
            this.completions.setConstructs([]);
            return;
          }
          this.setSyntaxError(
            errors,
            typeof lints === 'undefined' ? [] : lints
          );
          this.setExpansions(
            typeof expansions === 'undefined' ? [] : expansions
          );
          this.hover.setConstructs(seen);
          this.completions.setConstructs(seen);
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

  /** Breakpoints as the interpreter counts them: zero-based rows. */
  private breakpoints(): number[] {
    return this.editor.debug.rows(this.editor.view.state);
  }

  recieve(response: Response) {
    try {
      const { debugState, model, output, step, runtime, coverage } = response;
      this.setDebugging(debugState !== 'Stop');
      if (typeof response.constructs !== 'undefined') {
        this.statement.setConstructs(response.constructs);
        if (this.entryPath === this.activePath) {
          this.hover.setConstructs(response.constructs);
          this.completions.setConstructs(response.constructs);
        }
      }
      this.hover.setStep(model);
      this.statement.setStep(model);
      this.showWatches();
      this.setRuntimeDiagnostics(typeof runtime === 'undefined' ? [] : runtime);
      this.editor.debug.showCoverage(
        this.editor.view,
        typeof coverage === 'undefined' ? [] : coverage
      );
      if (debugState === 'Executing') {
        return;
      }
      this.bus.signal('changeState', debugState, step);
      this.bus.signal('changeOutput', output);
      this.bus.signal(
        'draw',
        model,
        this.statement.explainStatement(response.sourcecode)
      );
      this.setHighlightOnCode(debugState, model);
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
   * Where the name under a ctrl-click was declared.
   *
   * The constructs are the ones the last syntax check produced, so a program
   * that has not been checked - or one that does not parse - has nowhere to
   * send the reader, and the click stays a click. What the name refers to is
   * `declarations.ts`; what is added here is the conversion into the
   * document's own offsets, which is the editor's coordinate system and not
   * the interpreter's.
   */
  private declarationRange(request: DeclarationRequest) {
    const found = declarationFor(this.constructs, request);
    if (found === null) {
      return null;
    }
    return rangeOf(
      this.editor.view.state.doc,
      found.line,
      found.column,
      found.endLine,
      found.endColumn
    );
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

  setExpansions(expansions: Expansion[]) {
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
    this.editor.debug.showDiagnostics(
      this.editor.view,
      this.syntaxErrors,
      this.teachingLints.concat(this.runtimeLints)
    );
  }
}
