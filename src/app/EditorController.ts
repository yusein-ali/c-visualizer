import {
  Request,
  CONTROL_EVENT,
  InterpreterClient,
  Response,
  DEBUG_STATE,
  StepModel,
  SyntaxErrorModel,
} from '../core';
import strings from '../strings';
import { Expansion } from '../interpreter/Expansion';
import { PlivetEditor, rangeOf } from '../ui/editor';
import { HoverTextSource } from './hoverText';
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
}

export class EditorController {
  private readonly bus: Bus;
  private readonly client: InterpreterClient;
  private sourcecode: string;
  private readonly editor: PlivetEditor;
  private readonly hover: HoverTextSource;
  private isDebugging = false;
  private fontSize = 14;

  constructor(mount: HTMLElement, options: EditorControllerOptions) {
    const { bus, client, dark = false, doc = strings.sourceCode } = options;
    this.bus = bus;
    this.client = client;
    this.sourcecode = doc;
    this.hover = new HoverTextSource();

    this.editor = new PlivetEditor(mount, {
      doc: this.sourcecode,
      dark,
      fontSize: this.fontSize,
      hoverText: this.hover.text,
      onChange: (code: string) => this.edited(code),
    });

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
          const { errors, expansions, constructs } = response;
          this.setSyntaxError(errors);
          this.setExpansions(
            typeof expansions === 'undefined' ? [] : expansions
          );
          this.hover.setConstructs(
            typeof constructs === 'undefined' ? [] : constructs
          );
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
      const { debugState, model, output, step } = response;
      this.setDebugging(debugState !== 'Stop');
      this.hover.setVariables(model.variables);
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
    this.editor.debug.showStep(
      this.editor.view,
      rangeOf(
        this.editor.view.state.doc,
        codeRange.begin.y,
        codeRange.begin.x,
        codeRange.end.y,
        codeRange.end.x
      )
    );
  }

  setExpansions(expansions: Expansion[]) {
    this.hover.setExpansions(expansions);
    this.editor.debug.showExpansions(this.editor.view, expansions);
  }

  setSyntaxError(errors: SyntaxErrorModel[]) {
    this.editor.debug.showDiagnostics(this.editor.view, errors);
  }
}
