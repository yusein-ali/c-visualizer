import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { Construct } from '../src/interpreter/Construct';
import { declarationFor } from '../src/app/declarations';
import { focusField, goTo, gotoDeclaration } from '../src/ui/editor';

/**
 * Ctrl-click a name, and the editor goes to where it was declared.
 *
 * The part worth testing is the choosing, not the scrolling: `grep` finds
 * every `count` in a file and only one of them is the one this `count` means.
 * The rule is C's - a call is a function, a name is the nearest declaration
 * above it in the function it is in, and a parameter belongs to the function
 * that declares it.
 */

const PROGRAM = `int total = 100;
int twice(int n);
int twice(int n) {
  int total = 2;
  return n * total;
}
struct Pair { int left; };
typedef struct Pair Pair;
enum Mode { OFF, ON };
int main(void) {
  int count = 0;
  count = twice(count) + total;
  Pair pair;
  pair.left = ON;
  return count;
}`;

const constructsOf = (code: string): Construct[] => {
  const interpreter = new PlivetCPP14Interpreter();
  interpreter.setFileList(new Map());
  return interpreter.getConstructs(code);
};

const constructs = constructsOf(PROGRAM);

/** Where a ctrl-click on that name, on that line, would land. */
const goesTo = (word: string, line: number, isCall = false) => {
  const source = PROGRAM.split('\n')[line - 1];
  const found = declarationFor(constructs, {
    word,
    line,
    column: Math.max(source.indexOf(word), 0),
    isCall,
  });
  return found === null ? null : found.line;
};

describe('which declaration a name means', () => {
  it('sends a call to the definition rather than the prototype', () => {
    // The prototype is on line 2 and the body is on line 3, and a reader
    // asking about a call wants the body.
    expect(goesTo('twice', 12, true)).toBe(3);
  });

  it('sends a name to the nearest declaration above it', () => {
    // `total` is declared at file scope and again inside `twice`.
    expect(goesTo('total', 5)).toBe(4);
    expect(goesTo('total', 12)).toBe(1);
  });

  it('sends a parameter to the function that declares it', () => {
    expect(goesTo('n', 5)).toBe(3);
  });

  it('does not follow a local out of the function it belongs to', () => {
    // `count` is `main`'s; from inside `twice` there is no such object.
    expect(goesTo('count', 5)).toBeNull();
    expect(goesTo('count', 12)).toBe(11);
  });

  it('finds a type name, an enumeration constant and a member', () => {
    expect(goesTo('Pair', 13)).toBe(8);
    expect(goesTo('ON', 14)).toBe(9);
    expect(goesTo('left', 14)).toBe(7);
  });

  it('says nothing about a name this program does not declare', () => {
    // A library function, a macro already replaced, or a misspelling: none of
    // them has anywhere in this file to go.
    expect(goesTo('printf', 12, true)).toBeNull();
    expect(goesTo('lenght', 12)).toBeNull();
    expect(goesTo('', 12)).toBeNull();
  });
});

describe('the modifier the platform uses', () => {
  /** A click on the first character of `total` on line 12. */
  const clickAt = (view: EditorView, init: MouseEventInit): void => {
    view.posAtCoords = () => PROGRAM.indexOf('+ total') + 2;
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, ...init })
    );
  };

  const platform = (value: string) => {
    Object.defineProperty(navigator, 'platform', {
      value,
      configurable: true,
    });
  };
  const originalPlatform = navigator.platform;
  afterEach(() => platform(originalPlatform));

  const viewAsking = (asked: string[]) =>
    new EditorView({
      state: EditorState.create({
        doc: PROGRAM,
        extensions: [
          focusField,
          gotoDeclaration((request: any) => {
            asked.push(request.word);
            return null;
          }),
        ],
      }),
    });

  it('follows command-click on a Mac, and not ctrl-click', () => {
    // Ctrl-click is the secondary click there: the system opens a menu from
    // it, so a gesture bound to it could only work by stealing that.
    platform('MacIntel');
    const asked: string[] = [];
    const view = viewAsking(asked);
    clickAt(view, { metaKey: true });
    expect(asked).toEqual(['total']);
    clickAt(view, { ctrlKey: true });
    expect(asked).toEqual(['total']);
    view.destroy();
  });

  it('follows ctrl-click everywhere else, and not command-click', () => {
    platform('Win32');
    const asked: string[] = [];
    const view = viewAsking(asked);
    clickAt(view, { ctrlKey: true });
    expect(asked).toEqual(['total']);
    clickAt(view, { metaKey: true });
    expect(asked).toEqual(['total']);
    view.destroy();
  });

  it('leaves a secondary click to the menu it belongs to', () => {
    platform('Win32');
    const asked: string[] = [];
    const view = viewAsking(asked);
    view.posAtCoords = () => PROGRAM.indexOf('+ total') + 2;
    view.contentDOM.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 2, ctrlKey: true })
    );
    expect(asked).toEqual([]);
    view.destroy();
  });

  it('leaves alt-click to the watch it pins', () => {
    platform('Win32');
    const asked: string[] = [];
    const view = viewAsking(asked);
    clickAt(view, { ctrlKey: true, altKey: true });
    expect(asked).toEqual([]);
    view.destroy();
  });
});

describe('the jump itself', () => {
  const viewWith = (find: any) =>
    new EditorView({
      state: EditorState.create({
        doc: PROGRAM,
        extensions: [focusField, gotoDeclaration(find)],
      }),
    });

  it('moves the cursor to the declaration and marks it', () => {
    const view = viewWith(() => null);
    const line = view.state.doc.line(4);
    goTo(view, { from: line.from, to: line.to });

    expect(view.state.selection.main.anchor).toBe(line.from);
    // A line decoration and a mark over the declaration itself.
    expect(view.state.field(focusField).size).toBe(2);
    view.destroy();
  });

  it('goes to the declaration of the word under the cursor on F12', () => {
    const asked: string[] = [];
    const view = viewWith((request: any) => {
      asked.push(request.word);
      const line = view.state.doc.line(1);
      return { from: line.from, to: line.to };
    });
    const at = PROGRAM.indexOf('+ total') + 2;
    view.dispatch({ selection: { anchor: at } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F12', bubbles: true })
    );
    expect(asked).toEqual(['total']);
    expect(view.state.selection.main.anchor).toBe(view.state.doc.line(1).from);
    view.destroy();
  });

  it('says whether the name is being called', () => {
    const seen: boolean[] = [];
    const view = viewWith((request: any) => {
      seen.push(request.isCall);
      return null;
    });
    const call = PROGRAM.indexOf('twice(count)') + 2;
    const plain = PROGRAM.indexOf('+ total') + 3;
    view.dispatch({ selection: { anchor: call } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F12', bubbles: true })
    );
    view.dispatch({ selection: { anchor: plain } });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'F12', bubbles: true })
    );
    expect(seen).toEqual([true, false]);
    view.destroy();
  });
});
