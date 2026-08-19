import * as React from 'react';
import Alert from 'react-bootstrap/lib/Alert';
import Button from 'react-bootstrap/lib/Button';
import Modal from 'react-bootstrap/lib/Modal';
import Checkbox from 'react-bootstrap/lib/Checkbox';
// tslint:disable-next-line:import-name
import AceEditor from 'react-ace';

import 'ace-builds/src-min-noconflict/mode-c_cpp';
import 'ace-builds/src-min-noconflict/mode-java';
import 'ace-builds/src-min-noconflict/mode-python';
import 'ace-builds/src-min-noconflict/snippets/c_cpp';
import 'ace-builds/src-min-noconflict/snippets/java';
import 'ace-builds/src-min-noconflict/snippets/python';
import 'ace-builds/src-min-noconflict/theme-textmate';
import 'ace-builds/src-min-noconflict/theme-monokai';
import 'ace-builds/src-min-noconflict/ext-language_tools';

import '../css/editor.css';
import { signal, slot } from './emitter';
import {
  Request,
  CONTROL_EVENT,
  server,
  Response,
  DEBUG_STATE,
} from '../server';
import translate from '../locales/translate';
import { ExecState } from 'unicoen.ts/dist/interpreter/Engine/ExecState';
import { LangProps, ProgLangProps, Theme } from './Props';
import { SyntaxErrorData } from 'unicoen.ts/dist/interpreter/mapper/SyntaxErrorData';
import { Expansion } from '../interpreter/Expansion';
import {
  displayAddressOf,
  displayPointerValueOf,
  displayTypeOf,
  functionPointerInfoOf,
} from '../interpreter/RuntimeTypeInfo';
import {
  Construct,
  constructAt,
  EnumeratorDetail,
  FunctionDeclarationDetail,
  RecordFieldDetail,
  TypeDeclarationDetail,
  VariableDeclarationDetail,
} from '../interpreter/Construct';
import { libraryHelp } from './libraryHelp';
import { Variable } from 'unicoen.ts/dist/interpreter/Engine/Variable';

type Props = LangProps & ProgLangProps;
interface State {
  fontSize: number;
  showAlert: boolean;
  theme: Theme;
}

interface TextRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface GutterMousedownEventTarget
  extends React.BaseHTMLAttributes<HTMLElement> {
  getBoundingClientRect: () => TextRectangle;
}
interface GutterMousedownEvent extends React.MouseEvent {
  domEvent: React.MouseEvent<GutterMousedownEventTarget>;
  editor: AceAjax.Editor;
  getDocumentPosition: () => AceAjax.Position;
  stop: () => void;
}

export const formatAddress = (address: number): string =>
  `0x${address.toString(16).toUpperCase()}`;

export const formatVariableDeclaration = (
  declaration: VariableDeclarationDetail,
  lang: string
): string =>
  [
    `${translate(lang, 'declarationType')}: ${declaration.type}`,
    `${translate(lang, 'storageClass')}: ${
      declaration.storageClasses.join(', ') || translate(lang, 'none')
    }`,
    `${translate(lang, 'qualifiers')}: ${
      declaration.qualifiers.join(', ') || translate(lang, 'none')
    }`,
    `${translate(lang, 'identifier')}: ${declaration.identifier}`,
    `${translate(lang, 'value')}: ${
      declaration.initialValue === null
        ? translate(lang, 'uninitialized')
        : declaration.initialValue
    }`,
  ].join('\n');

/**
 * A C declaration always names a complete type - storage class and type, with
 * only the qualifiers optional - so the tooltip lists every part and says
 * `none` where the source left one out. The last line takes the standard's
 * own term for the name being introduced: a typedef declarator defines a
 * typedef name, a record or enumeration definition names a tag.
 */
export const formatTypeDeclaration = (
  declaration: TypeDeclarationDetail,
  lang: string
): string =>
  [
    `${translate(lang, 'declarationType')}: ${declaration.type}`,
    `${translate(lang, 'storageClass')}: ${
      declaration.storageClasses.join(', ') || translate(lang, 'none')
    }`,
    `${translate(lang, 'qualifiers')}: ${
      declaration.qualifiers.join(', ') || translate(lang, 'none')
    }`,
    `${translate(lang, declaration.nameKind)}: ${
      declaration.name || translate(lang, 'none')
    }`,
  ].join('\n');

/**
 * What an enumerator declares. The value is the point of it: nothing in
 * `enum Mode { OFF, ON = 4, FAULT }` tells a reader that FAULT is 5.
 */
export const formatEnumerator = (
  declaration: EnumeratorDetail,
  lang: string
): string =>
  [
    `${translate(lang, 'declarationType')}: ${declaration.type}`,
    `${translate(lang, 'enumeration')}: ${declaration.enumeration}`,
    `${translate(lang, 'identifier')}: ${declaration.identifier}`,
    `${translate(lang, 'value')}: ${declaration.value}`,
  ].join('\n');

/** A structure or union member, described where its name is declared. */
export const formatRecordField = (
  declaration: RecordFieldDetail,
  lang: string
): string =>
  [
    `${translate(lang, 'declarationType')}: ${declaration.type}`,
    `${translate(lang, 'record')}: ${declaration.record}`,
    `${translate(lang, 'identifier')}: ${declaration.identifier}`,
  ].join('\n');

/**
 * What a function declaration says, in the standard's own words: the type it
 * returns, the identifier it declares (6.9.1), and its parameters (3.16) - one
 * per line, each named before the type it has, the way the declaration reads.
 * `void` in a parameter list declares no parameters, so it is reported as
 * none rather than as a parameter called nothing.
 */
export const formatFunctionDeclaration = (
  declaration: FunctionDeclarationDetail,
  lang: string
): string =>
  [
    `${translate(lang, 'returnType')}: ${declaration.returnType}`,
    `${translate(lang, 'identifier')}: ${declaration.identifier}`,
    declaration.parameters.length === 0
      ? `${translate(lang, 'parameters')}: ${translate(lang, 'none')}`
      : [`${translate(lang, 'parameters')}:`]
          .concat(
            declaration.parameters.map(
              (parameter) => `  ${parameter.identifier}: ${parameter.type}`
            )
          )
          .join('\n'),
  ].join('\n');

export default class Editor extends React.Component<Props, State> {
  private sentSourcecode: string;
  private preventedCommand: CONTROL_EVENT = 'Stop';
  private sourcecode: string;
  private ace: any = null;
  private editorRef = React.createRef<any>();
  private lineNumOfBreakpoint: number[] = [];
  private isDebugging = false;
  private checkbox: HTMLInputElement | null = null;
  private noAlert: boolean = false;
  private highlightIds: number[] = [];
  private expansions: Expansion[] = [];
  private constructs: Construct[] = [];
  private execState?: ExecState;
  private expansionMarkerIds: number[] = [];
  private tooltip: HTMLDivElement | null = null;
  constructor(props: Props) {
    super(props);

    this.state = { fontSize: 14, showAlert: false, theme: 'light' };
    const { lang, progLang } = props;
    this.sourcecode = translate(lang, this.sourceCodeKey(progLang));
    this.sentSourcecode = '';

    this.hideAlert = this.hideAlert.bind(this);

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
        this.setState({ fontSize: this.state.fontSize + 1 });
      } else if (command === 'Out') {
        this.setState({ fontSize: Math.max(this.state.fontSize - 1, 10) });
      } else if (command === 'Reset') {
        this.setState({ fontSize: 14 });
      }
    });
    slot('changeTheme', async (theme: Theme) => {
      this.setState({ theme });
    });
  }

  componentDidMount() {
    // Enable breakpoint
    const editor: AceAjax.Editor = this.editorRef.current.editor;
    editor.on('keydown', (e: any) => {
      console.log(e);
    });
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'macro-tooltip';
    this.tooltip.style.display = 'none';
    editor.container.appendChild(this.tooltip);
    // A DOM listener rather than editor.on('mousemove'): the position is
    // resolved through the renderer, so this does not depend on Ace's mouse
    // plumbing forwarding the event.
    editor.container.addEventListener('mousemove', (e: MouseEvent) =>
      this.showExpansionTooltip(e)
    );
    editor.container.addEventListener('mouseleave', () => this.hideTooltip());
    editor.getSession().on('changeScrollTop', () => this.hideTooltip());

    editor.on('guttermousedown', (e: GutterMousedownEvent) => {
      const target: GutterMousedownEventTarget = e.domEvent.currentTarget;
      if (
        typeof target.className !== 'undefined' &&
        target.className.indexOf('ace_gutter') === -1
      ) {
        return;
      }
      if (!editor.isFocused()) {
        return;
      }
      if (e.clientX > 25 + target.getBoundingClientRect().left) return;

      const row: number = e.getDocumentPosition().row;

      const session: AceAjax.IEditSession = e.editor.getSession();
      if (this.lineNumOfBreakpoint.includes(row)) {
        session.clearBreakpoint(row);
        this.lineNumOfBreakpoint = this.lineNumOfBreakpoint.filter(
          (n) => n !== row
        );
      } else {
        session.setBreakpoint(row, 'ace_breakpoint');
        this.lineNumOfBreakpoint.push(row);
      }
      e.stop();
    });
  }

  sourceCodeKey = (prog: string) =>
    'sourceCode' +
    prog.replace(/_/g, '').replace(/^[a-z]/g, (char) => char.toUpperCase());

  componentWillReceiveProps(nextProps: Props) {
    const { lang, progLang } = this.props;
    const nextLang = nextProps.lang;
    const nextProgLang = nextProps.progLang;

    if (nextLang !== lang) {
      if (this.sourcecode === translate(lang, this.sourceCodeKey(progLang))) {
        this.sourcecode = translate(nextLang, this.sourceCodeKey(nextProgLang));
      }
    } else if (nextProgLang !== progLang) {
      this.sourcecode = translate(nextLang, this.sourceCodeKey(nextProgLang));
    }
  }

  send(controlEvent: CONTROL_EVENT, stdinText?: string) {
    const sourcecode = this.sourcecode;
    const lineNumOfBreakpoint = this.lineNumOfBreakpoint;
    const progLang = this.props.progLang;
    const request: Request = {
      sourcecode,
      controlEvent,
      stdinText,
      lineNumOfBreakpoint,
      progLang,
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
          this.constructs = typeof constructs === 'undefined' ? [] : constructs;
        })
        .catch((e) => {
          console.log(e);
          alert(e);
        });
    } else if (
      !this.noAlert &&
      this.isDebugging &&
      (controlEvent === 'BackAll' ||
        controlEvent === 'StepBack' ||
        controlEvent === 'Step' ||
        controlEvent === 'StepAll') &&
      sourcecode !== this.sentSourcecode
    ) {
      this.preventedCommand = controlEvent;
      this.setState({ showAlert: true });
    } else {
      this.setState({ showAlert: false });
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
  }

  recieve(response: Response) {
    try {
      const {
        debugState,
        execState,
        output,
        step,
        sourcecode,
        files,
      } = response;
      this.isDebugging = debugState !== 'Stop';
      // Kept for the hover tooltips: the values of the variables as they are
      // right now, which is what a reader wants while stepping.
      this.execState = debugState === 'Stop' ? undefined : execState;
      this.sentSourcecode = sourcecode;
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

  setHighlightOnCode(debugState: DEBUG_STATE, execState?: ExecState) {
    if (debugState === 'Stop') {
      return;
    }
    if (typeof execState === 'undefined') {
      return;
    }
    let codeRange = execState.getNextExpr().codeRange;
    const AceRange = this.ace.acequire('ace/range').Range;
    const editor: AceAjax.Editor = this.editorRef.current.editor;
    if (codeRange) {
      const range: AceAjax.Range = new AceRange(
        codeRange.begin.y - 1,
        codeRange.begin.x,
        codeRange.end.y - 1,
        codeRange.end.x + 1
      );
      editor.resize(true);
      // tslint:disable-next-line:no-empty
      editor.scrollToLine(codeRange.begin.y, true, true, () => {});
      if (debugState === 'EOF') {
        editor.getSelection().setSelectionRange(new AceRange(-1, 0, -1, 1));
      } else {
        editor.getSelection().setSelectionRange(range);
      }
    }
  }

  /**
   * Marks every span the preprocessor replaced. The pass keeps line numbers, so
   * a recorded position still refers to the line the user is looking at, and
   * the mark can sit directly under the macro they wrote.
   */
  setExpansions(expansions: Expansion[]) {
    this.expansions = expansions;
    const editor: AceAjax.Editor = this.editorRef.current.editor;
    const session: AceAjax.IEditSession = editor.getSession();
    for (const id of this.expansionMarkerIds) {
      session.removeMarker(id);
    }
    this.expansionMarkerIds = [];
    if (this.ace === null) {
      return;
    }
    const AceRange = this.ace.acequire('ace/range').Range;
    for (const expansion of expansions) {
      const range = new AceRange(
        expansion.line - 1,
        expansion.column,
        expansion.line - 1,
        expansion.column + expansion.length
      );
      const style =
        expansion.kind === 'macro'
          ? 'macro-expansion'
          : expansion.kind === 'directive'
          ? 'directive-line'
          : 'excluded-region';
      this.expansionMarkerIds.push(
        session.addMarker(range, style, 'text', false)
      );
    }
  }

  private expansionAt(row: number, column: number): Expansion | null {
    let found: Expansion | null = null;
    for (const expansion of this.expansions) {
      if (
        expansion.line - 1 === row &&
        expansion.column <= column &&
        column < expansion.column + expansion.length
      ) {
        // Narrowest wins: a macro named inside a directive sits within the
        // span of the directive itself, and it is the more specific answer.
        if (found === null || expansion.length < found.length) {
          found = expansion;
        }
      }
    }
    return found;
  }

  private showExpansionTooltip(event: MouseEvent) {
    if (this.tooltip === null || this.editorRef.current === null) {
      return;
    }
    const editor: AceAjax.Editor = this.editorRef.current.editor;
    // @types/ace declares this as returning void; it returns a Position.
    const position = (editor.renderer.screenToTextCoordinates(
      event.clientX,
      event.clientY
    ) as unknown) as AceAjax.Position;
    const text = this.hoverText(editor, position);
    if (text === null) {
      this.hideTooltip();
      return;
    }
    this.tooltip.textContent = text;
    this.tooltip.style.display = 'block';
    const bounds = editor.container.getBoundingClientRect();
    this.tooltip.style.left = `${event.clientX - bounds.left + 12}px`;
    this.tooltip.style.top = `${event.clientY - bounds.top + 18}px`;
  }

  /**
   * What to say about the position under the cursor, most specific first: the
   * value a variable holds right now, then what the preprocessor did there,
   * then the library function being called, then the construct the parser saw.
   */
  private hoverText(
    editor: AceAjax.Editor,
    position: AceAjax.Position
  ): string | null {
    const session: AceAjax.IEditSession = editor.getSession();
    const wordRange = session.getWordRange(position.row, position.column);
    const word = session.getTextRange(wordRange).trim();

    const variable = this.variableNamed(word);
    if (variable !== null) {
      return this.variableText(variable);
    }

    const expansion = this.expansionAt(position.row, position.column);
    if (expansion !== null) {
      return this.expansionText(expansion);
    }

    const help = libraryHelp(word);
    if (help !== null) {
      const lang = this.props.lang;
      return `${help.signature}\n${lang === 'ja' ? help.ja : help.en}`;
    }

    const construct = constructAt(
      this.constructs,
      position.row + 1,
      position.column
    );
    if (construct !== null) {
      const name = translate(
        this.props.lang,
        `construct${construct.kind
          .charAt(0)
          .toUpperCase()}${construct.kind.slice(1)}`
      );
      if (
        construct.kind === 'variableDec' &&
        typeof construct.variableDeclarations !== 'undefined'
      ) {
        const declarations = construct.variableDeclarations.map((declaration) =>
          formatVariableDeclaration(declaration, this.props.lang)
        );
        return `${name}\n${declarations.join('\n\n')}`;
      }
      if (
        construct.kind === 'enumerator' &&
        typeof construct.enumerator !== 'undefined'
      ) {
        return `${name}\n${formatEnumerator(
          construct.enumerator,
          this.props.lang
        )}`;
      }
      if (
        construct.kind === 'recordField' &&
        typeof construct.recordField !== 'undefined'
      ) {
        return `${name}\n${formatRecordField(
          construct.recordField,
          this.props.lang
        )}`;
      }
      if (
        construct.kind === 'functionDec' &&
        typeof construct.declaredFunction !== 'undefined'
      ) {
        return `${name}\n${formatFunctionDeclaration(
          construct.declaredFunction,
          this.props.lang
        )}`;
      }
      if (
        construct.kind === 'typeDec' &&
        typeof construct.declaredTypes !== 'undefined'
      ) {
        const declared = construct.declaredTypes.map((declaration) =>
          formatTypeDeclaration(declaration, this.props.lang)
        );
        return `${name}\n${declared.join('\n\n')}`;
      }
      return construct.detail === '' ? name : `${name} — ${construct.detail}`;
    }
    return null;
  }

  /** The variable of that name in the innermost frame that has one. */
  private variableNamed(name: string): Variable | null {
    if (typeof this.execState === 'undefined' || name === '') {
      return null;
    }
    const stacks = this.execState.getStacks();
    for (let i = stacks.length - 1; 0 <= i; i -= 1) {
      for (const variable of stacks[i].getVariables()) {
        // A bare word never refers to a struct member: those are recorded
        // under the member name with the struct as their parent.
        if (
          variable.getName() === name &&
          typeof variable.parentName === 'undefined'
        ) {
          return variable;
        }
      }
    }
    return null;
  }

  /**
   * Everything shown here goes through the display layer rather than the
   * runtime one. An enum, a record and a function pointer all execute under a
   * synthetic type the source never contained, and addresses are laid out for
   * the reader before the canvas draws them - so reading `type` and `address`
   * off the variable would both leak `_fp0` into the tooltip and put a
   * different address in it than the box beside it shows.
   */
  private variableText(variable: Variable): string {
    const lang = this.props.lang;
    const type = displayTypeOf(variable);
    const value = this.variableValue(variable, type);
    const target = this.pointerTarget(variable);
    return (
      `${variable.name} : ${type} = ${value}${target}\n` +
      `${translate(lang, 'atAddress')} ${formatAddress(
        displayAddressOf(variable)
      )}`
    );
  }

  /**
   * What a variable holds. A pointer is an address whichever kind it is, so it
   * is always shown as one; a function pointer is named as well, because the
   * address on its own says nothing about which function was chosen.
   */
  private variableValue(variable: Variable, type: string): string {
    const held = variable.getValue();
    const functionInfo = functionPointerInfoOf(variable);
    if (functionInfo !== null && held != null && !Array.isArray(held)) {
      // The engine stores an `int` as a boxed number, so a null callback would
      // print as a bare `0` if this went through the generic path.
      const address = formatAddress(Number(held.valueOf()));
      return functionInfo.pointee === null
        ? address
        : `${functionInfo.pointee} (${address})`;
    }
    const pointerValue = displayPointerValueOf(variable);
    if (pointerValue !== null) {
      return formatAddress(pointerValue);
    }
    return this.formatValue(held, type);
  }

  /** For a pointer, the variable it points at - the arrow the canvas draws. */
  private pointerTarget(variable: Variable): string {
    const value = variable.getValue();
    if (
      typeof this.execState === 'undefined' ||
      variable.type.indexOf('*') === -1 ||
      typeof value !== 'number'
    ) {
      return '';
    }
    for (const stack of this.execState.getStacks()) {
      const found = this.variableAt(stack.getVariables(), value);
      if (found !== null) {
        return ` → ${found.getName()} = ${this.formatValue(
          found.getValue(),
          found.type
        )}`;
      }
    }
    return '';
  }

  /**
   * The variable living at an address. Array elements are Variables held in
   * their array's value rather than in the frame, so a pointer into an array -
   * the common case the canvas draws an arrow for - is only found by looking
   * inside.
   */
  private variableAt(variables: Variable[], address: number): Variable | null {
    for (const variable of variables) {
      if (variable.address === address) {
        return variable;
      }
      const value = variable.getValue();
      if (Array.isArray(value)) {
        const elements = value.filter(
          (element: any) =>
            element !== null &&
            typeof element === 'object' &&
            typeof element.getValue === 'function'
        );
        const found = this.variableAt(elements, address);
        if (found !== null) {
          return found;
        }
      }
    }
    return null;
  }

  private formatValue(value: any, type: string): string {
    if (value === null || typeof value === 'undefined') {
      return '?';
    }
    if (Array.isArray(value)) {
      // Array elements are Variables, not raw values.
      const shown = value
        .slice(0, 8)
        .map((element: any) =>
          element !== null &&
          typeof element === 'object' &&
          typeof element.getValue === 'function'
            ? this.variableValue(element, displayTypeOf(element))
            : this.formatValue(element, '')
        );
      return `[${shown.join(', ')}${value.length > 8 ? ', …' : ''}]`;
    }
    if (typeof value === 'number' && type.indexOf('*') !== -1) {
      return formatAddress(value);
    }
    if (typeof value === 'number' && type.indexOf('char') !== -1) {
      return `'${String.fromCharCode(value)}' (${value})`;
    }
    return String(value);
  }

  /** One line of what happened, and one of why, in the interface language. */
  private expansionText(expansion: Expansion): string {
    const lang = this.props.lang;
    if (expansion.kind === 'excluded') {
      return `${expansion.name}: ${translate(lang, 'excludedLine')}`;
    }
    if (expansion.kind === 'directive') {
      const head = `${expansion.name} ${expansion.text}`.trim();
      if (typeof expansion.taken === 'undefined') {
        return head;
      }
      return `${head}\n${translate(
        lang,
        expansion.taken ? 'branchCompiled' : 'branchSkipped'
      )}`;
    }
    const head = `${expansion.name} → ${expansion.text}`;
    return typeof expansion.definedAt === 'undefined'
      ? head
      : `${head}\n${translate(lang, 'definedOnLine')} ${expansion.definedAt}`;
  }

  private hideTooltip() {
    if (this.tooltip !== null) {
      this.tooltip.style.display = 'none';
    }
  }

  setSyntaxError(errors: SyntaxErrorData[]) {
    const editor: AceAjax.Editor = this.editorRef.current.editor;
    const annotations = errors.map((error: SyntaxErrorData) => {
      return {
        row: error.line - 1,
        column: error.charPositionInLine - 1,
        text: error.getMsg(),
        type: 'error',
      };
    });
    const session: AceAjax.IEditSession = editor.getSession();
    session.setAnnotations(annotations);
    for (const highlightId of this.highlightIds) {
      session.removeMarker(highlightId);
    }
    this.highlightIds = [];
    for (const annotation of annotations) {
      const range = (session as any).highlightLines(
        annotation.row,
        annotation.row,
        'error_line'
      );
      this.highlightIds.push(range.id);
    }
  }

  render() {
    return (
      <React.Fragment>
        {this.state.showAlert ? this.renderAlert() : null} {this.renderEditor()}
      </React.Fragment>
    );
  }

  renderEditor() {
    const mode = this.props.progLang;
    const { fontSize, theme } = this.state;
    return (
      <AceEditor
        ref={this.editorRef}
        mode={mode}
        theme={theme === 'light' ? 'textmate' : 'monokai'}
        value={this.sourcecode}
        name="sourcecode"
        fontSize={fontSize}
        tabSize={2}
        editorProps={{
          $blockScrolling: Infinity,
        }}
        setOptions={{
          enableBasicAutocompletion: true,
          enableLiveAutocompletion: true,
          showLineNumbers: true,
          readOnly: false,
        }}
        style={{ height: '62vh', width: 'auto' }}
        className="editorMain"
        onChange={(text: string) => {
          this.sourcecode = text;
          const delaySyntaxCheck = (code: string) => {
            if (code === this.sourcecode) {
              signal('debug', 'SyntaxCheck');
            }
          };
          setTimeout(() => delaySyntaxCheck(text), 1000);
        }}
        onBeforeLoad={(ace) => (this.ace = ace)}
      />
    );
  }

  hideAlert() {
    this.setState({ showAlert: false });
  }

  renderAlert() {
    const { lang } = this.props;
    const warning = translate(lang, 'warning');
    const editInDebug = translate(lang, 'editInDebug');
    const continueDebug = translate(lang, 'continueDebug');
    const restart = translate(lang, 'restart');
    const rememberCommand = translate(lang, 'rememberCommand');
    return (
      <Modal.Dialog
        className="modal-container"
        aria-labelledby="ModalHeader"
        // animation={true}
        tabIndex={-1}
        role="dialog"
      >
        <Modal.Header closeButton>
          <Modal.Title>{warning}</Modal.Title>
        </Modal.Header>
        <Alert bsStyle="danger">
          <p>{editInDebug}</p>
        </Alert>
        <Modal.Footer>
          <Button
            bsStyle="danger"
            onClick={() => {
              this.isDebugging = false;
              if (this.checkbox !== null) {
                this.noAlert = this.checkbox.checked;
              }
              signal('debug', this.preventedCommand);
            }}
          >
            {continueDebug}
          </Button>
          <Button
            onClick={() => {
              this.isDebugging = false;
              if (this.checkbox !== null) {
                this.noAlert = this.checkbox.checked;
              }
              signal('debug', 'Start');
            }}
          >
            {restart}
          </Button>
          <Checkbox
            validationState="warning"
            inputRef={(ref) => (this.checkbox = ref)}
          >
            {rememberCommand}
          </Checkbox>
        </Modal.Footer>
      </Modal.Dialog>
    );
  }
}
