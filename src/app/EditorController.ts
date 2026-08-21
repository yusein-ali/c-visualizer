import {
  Request,
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
import { Expansion } from '../interpreter/Expansion';
import {
  EditableRegion,
  LibraryFunction,
  SessionJSON,
  PlivetEditor,
  ProgramCompletions,
  rangeOf,
  TeachingDiagnostic,
} from '../ui/editor';
import { HoverTextSource } from './hoverText';
import { libraryHelp, libraryNames } from './libraryHelp';
import { Bus } from './emitter';
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

export class EditorController {
  private readonly bus: Bus;
  private readonly client: InterpreterClient;
  private sourcecode: string;
  private readonly editor: PlivetEditor;
  private readonly hover: HoverTextSource;
  private readonly completions: ProgramCompletions;
  private isDebugging = false;
  private fontSize = 14;
  /**
   * The three things the linter shows, kept apart because they arrive apart:
   * the parser answers on every edit, the teaching rules with it, and the run
   * answers on every step. The linter holds one set, so all three are handed
   * over together whenever any of them changes.
   */
  private syntaxErrors: SyntaxErrorModel[] = [];
  private teachingLints: TeachingDiagnostic[] = [];
  private runtimeLints: TeachingDiagnostic[] = [];

  constructor(mount: HTMLElement, options: EditorControllerOptions) {
    const {
      bus,
      client,
      dark = false,
      doc = strings.sourceCode,
      editableRegions = [],
    } = options;
    this.bus = bus;
    this.client = client;
    this.sourcecode = doc;
    this.hover = new HoverTextSource();
    this.completions = new ProgramCompletions(libraryFunctions());

    this.editor = new PlivetEditor(mount, {
      doc: this.sourcecode,
      dark,
      fontSize: this.fontSize,
      hoverText: this.hover.describe,
      onHoverObject: (object: string | null) =>
        this.bus.signal('focusObject', object, 'editor'),
      onWatchesChanged: () => this.showWatches(),
      completions: this.completions.source,
      onChange: (code: string) => this.edited(code),
    });

    if (editableRegions.length !== 0) {
      this.editor.debug.setEditableRegions(this.editor.view, editableRegions);
    }

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

  setDark(dark: boolean): void {
    this.editor.setDark(dark);
  }

  /** The program as it stands, for whoever needs to read it rather than run it. */
  code(): string {
    return this.sourcecode;
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
    this.editor.destroy();
  }

  private setFontSize(fontSize: number) {
    this.fontSize = fontSize;
    this.editor.setFontSize(fontSize);
  }

  /** Every edit, with the syntax check that follows a second of quiet. */
  private edited(code: string) {
    this.sourcecode = code;
    setTimeout(() => {
      if (code === this.sourcecode) {
        this.bus.signal('debug', 'SyntaxCheck');
      }
    }, 1000);
  }

  send(controlEvent: CONTROL_EVENT, stdinText?: string) {
    const request: Request = {
      sourcecode: this.sourcecode,
      controlEvent,
      stdinText,
      lineNumOfBreakpoint: this.breakpoints(),
    };
    if (controlEvent === 'SyntaxCheck') {
      this.client
        .send(request)
        .then((response: Response) => {
          const { errors, expansions, constructs, lints } = response;
          this.setSyntaxError(
            errors,
            typeof lints === 'undefined' ? [] : lints
          );
          this.setExpansions(
            typeof expansions === 'undefined' ? [] : expansions
          );
          const seen = typeof constructs === 'undefined' ? [] : constructs;
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
      this.hover.setStep(model);
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
      this.bus.signal('draw', model);
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
