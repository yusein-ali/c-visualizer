import * as React from 'react';

import '../css/editor.css';
import { signal, slot } from './emitter';
import {
  Request,
  CONTROL_EVENT,
  server,
  Response,
  DEBUG_STATE,
} from '../server';
import strings from '../strings';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { Theme } from './Props';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { Expansion } from '../interpreter/Expansion';
import { PlivetEditor, rangeOf } from '../ui/editor';
import { HoverTextSource } from './hoverText';

interface Props {}
interface State {}

/**
 * The editor's place in the application: it holds the source, sends every
 * debug command to the interpreter, and hands what comes back to the editor
 * and to the rest of the interface.
 *
 * The editing itself belongs to `PlivetEditor` under `src/ui/editor`, which
 * knows nothing about React and nothing about the interpreter. This component
 * is the wiring between the two, and it is what Phase 9 deletes.
 */
export default class Editor extends React.Component<Props, State> {
  private sourcecode: string;
  private editor: PlivetEditor | null = null;
  private container = React.createRef<HTMLDivElement>();
  private isDebugging = false;
  private theme: Theme = 'light';
  private fontSize = 14;
  private hover: HoverTextSource;

  constructor(props: Props) {
    super(props);

    this.sourcecode = strings.sourceCode;
    this.hover = new HoverTextSource();

    slot('debug', (controlEvent: CONTROL_EVENT, stdinText?: string) => {
      this.send(controlEvent, stdinText);
    });
    slot('EOF', (response: Response) => {
      this.recieve(response);
    });
    slot('stdin', (response: Response) => {
      this.recieve(response);
    });
    slot('Breakpoint', (response: Response) => {
      this.recieve(response);
    });
    slot('zoom', (command: string) => {
      if (command === 'In') {
        this.setFontSize(this.fontSize + 1);
      } else if (command === 'Out') {
        this.setFontSize(Math.max(this.fontSize - 1, 10));
      } else if (command === 'Reset') {
        this.setFontSize(14);
      }
    });
    slot('changeTheme', (theme: Theme) => {
      this.theme = theme;
      if (this.editor !== null) {
        this.editor.setDark(theme === 'dark');
      }
    });
  }

  componentDidMount() {
    if (this.container.current === null) {
      return;
    }
    this.editor = new PlivetEditor(this.container.current, {
      doc: this.sourcecode,
      dark: this.theme === 'dark',
      fontSize: this.fontSize,
      hoverText: this.hover.text,
      onChange: (code: string) => this.edited(code),
    });
  }

  componentWillUnmount() {
    if (this.editor !== null) {
      this.editor.destroy();
      this.editor = null;
    }
  }

  private setFontSize(fontSize: number) {
    this.fontSize = fontSize;
    if (this.editor !== null) {
      this.editor.setFontSize(fontSize);
    }
  }

  /** Every edit, with the syntax check that follows a second of quiet. */
  private edited(code: string) {
    this.sourcecode = code;
    setTimeout(() => {
      if (code === this.sourcecode) {
        signal('debug', 'SyntaxCheck');
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
      server
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
    server
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
    return this.editor === null
      ? []
      : this.editor.debug.rows(this.editor.view.state);
  }

  recieve(response: Response) {
    try {
      const { debugState, execState, output, step, files } = response;
      this.setDebugging(debugState !== 'Stop');
      this.hover.setExecState(debugState === 'Stop' ? undefined : execState);
      if (debugState === 'Executing') {
        return;
      }
      signal('changeState', debugState, step);
      signal('changeOutput', output);
      signal('draw', execState);
      signal('files', files);
      this.setHighlightOnCode(debugState, execState);
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
    if (this.editor !== null) {
      this.editor.debug.setReadOnly(this.editor.view, isDebugging);
    }
  }

  setHighlightOnCode(debugState: DEBUG_STATE, execState?: ExecState) {
    if (this.editor === null) {
      return;
    }
    if (debugState === 'Stop' || typeof execState === 'undefined') {
      this.editor.debug.showStep(this.editor.view, null);
      return;
    }
    const codeRange = execState.getNextExpr().codeRange;
    if (!codeRange) {
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
    if (this.editor !== null) {
      this.editor.debug.showExpansions(this.editor.view, expansions);
    }
  }

  setSyntaxError(errors: SyntaxErrorData[]) {
    if (this.editor !== null) {
      this.editor.debug.showDiagnostics(this.editor.view, errors);
    }
  }

  render() {
    return <div className="editorMain" ref={this.container} />;
  }
}
