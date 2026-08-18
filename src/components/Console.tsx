import * as React from 'react';
// tslint:disable-next-line:import-name
import AceEditor from 'react-ace';

import 'ace-builds/src-min-noconflict/mode-text';
import 'ace-builds/src-min-noconflict/theme-textmate';
import 'ace-builds/src-min-noconflict/theme-monokai';

import '../css/console.css';
import { slot, signal } from './emitter';
import { LangProps, Theme } from './Props';
import { DEBUG_STATE } from '../server';
type Props = LangProps;

interface State {
  output: string;
  theme: Theme;
  isReadOnly: boolean;
}

export default class Console extends React.Component<Props, State> {
  private editorRef = React.createRef<any>();
  constructor(props: Props) {
    super(props);
    this.state = { output: '', theme: 'light', isReadOnly: true };

    this.onChange = this.onChange.bind(this);
    this.onCursorChange = this.onCursorChange.bind(this);

    slot('changeOutput', (output: string) => {
      this.setState({ output });
    });
    slot('changeTheme', async (theme: Theme) => {
      this.setState({ theme });
    });
    slot('changeState', async (debugState: DEBUG_STATE) => {
      // Typable exactly while the program is blocked on a read.
      this.setState({ isReadOnly: debugState !== 'stdin' });
    });
  }
  componentDidUpdate(_prevProps: Props, prevState: State) {
    if (
      prevState.output !== this.state.output ||
      prevState.isReadOnly !== this.state.isReadOnly
    ) {
      this.moveCaretToEnd();
    }
  }

  // react-ace saves the selection, replaces the value and restores that same
  // selection (lib/ace.js:151-157), so freshly printed output leaves the caret
  // where it was - typically inside the text just printed. Put it back at the
  // end of the buffer, which for a console is the only place input belongs.
  private moveCaretToEnd() {
    const ace = this.editorRef.current;
    if (ace === null || typeof ace.editor === 'undefined') {
      return;
    }
    const editor: AceAjax.Editor = ace.editor;
    editor.navigateFileEnd();
    editor.renderer.scrollCursorIntoView();
  }

  // Clicking into already-printed output would otherwise insert the typed
  // value in the middle of it, and the submitted line is parsed as whatever
  // follows the output - so a stray caret sends nonsense to scanf.
  onCursorChange() {
    if (this.state.isReadOnly) {
      return;
    }
    const ace = this.editorRef.current;
    if (ace === null || typeof ace.editor === 'undefined') {
      return;
    }
    const editor: AceAjax.Editor = ace.editor;
    const document = editor.getSession().getDocument();
    const index = document.positionToIndex(editor.getCursorPosition(), 0);
    if (index < this.state.output.length) {
      this.moveCaretToEnd();
    }
  }

  onChange(text: string) {
    if (text.endsWith('\n')) {
      // 改行文字削除&今回入力部分のみ残す
      const typed = text.slice(0, -1);
      const sendText = typed.startsWith(this.state.output)
        ? typed.slice(this.state.output.length)
        : typed.replace(this.state.output, '');
      this.setState({ output: text, isReadOnly: true });
      // Resume rather than single-step: the run stops at the next read, at a
      // breakpoint or at EOF, so the console re-opens on its own for the next
      // value instead of waiting for a Step press that is easy to miss.
      signal('debug', 'StepAll', sendText);
    }
  }
  render() {
    const { theme } = this.state;
    return (
      <AceEditor
        mode="text"
        theme={theme === 'light' ? 'textmate' : 'monokai'}
        ref={this.editorRef}
        value={this.state.output}
        onChange={this.onChange}
        onCursorChange={this.onCursorChange}
        name="IO"
        fontSize={14}
        editorProps={{ $blockScrolling: true }}
        setOptions={{
          enableBasicAutocompletion: false,
          enableLiveAutocompletion: false,
          showLineNumbers: false,
          readOnly: this.state.isReadOnly,
          showGutter: false,
        }}
        style={{ height: '18vh', width: 'auto' }}
        className="console"
      />
    );
  }
}
