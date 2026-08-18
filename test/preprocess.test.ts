import { preprocess } from '../src/interpreter/preprocess';

/**
 * The cases mirror `baseline/scripts/probe-preprocessor.js`, which records what
 * the stock unicoen.ts pass does. Everything asserted here is something that
 * pass got wrong, plus the behaviour that has to keep working.
 */

const lines = (code: string) => preprocess(code).split('\n');

describe('object-like macros', () => {
  it('expands a macro in an expression', () => {
    expect(preprocess('#define N 7\nint x = N;')).toBe('\nint x = 7;');
  });

  it('expands a macro that refers to another macro', () => {
    const out = preprocess('#define TWO 2\n#define FOUR (TWO*2)\nint x = FOUR;');
    expect(out.trim()).toBe('int x = (2*2);');
  });

  it('accepts a valueless flag instead of hanging', () => {
    expect(preprocess('#define DEBUG\nint x = 1;').trim()).toBe('int x = 1;');
  });

  it('is not confused by the word appearing in a comment', () => {
    const out = preprocess('/* mentioning #define\n   in prose */\nint x = 1;');
    expect(out.trim().endsWith('int x = 1;')).toBe(true);
  });

  it('stops expanding after #undef', () => {
    expect(preprocess('#define N 7\n#undef N\nint N = 1;').trim()).toBe(
      'int N = 1;'
    );
  });
});

describe('textual substitution traps', () => {
  it('leaves macro names inside string literals alone', () => {
    expect(preprocess('#define N 7\nputs("N=%d");').trim()).toBe('puts("N=%d");');
  });

  it('leaves macro names inside longer identifiers alone', () => {
    expect(preprocess('#define N 7\nint Now = 1;').trim()).toBe('int Now = 1;');
  });

  it('leaves macro names inside comments alone', () => {
    expect(preprocess('#define N 7\n/* N is the size */ int x = N;').trim()).toBe(
      '/* N is the size */ int x = 7;'
    );
  });

  it('leaves macro names inside character literals alone', () => {
    expect(preprocess("#define N 7\nchar c = 'N';").trim()).toBe("char c = 'N';");
  });
});

describe('function-like macros', () => {
  it('expands a call with an arbitrary argument', () => {
    expect(preprocess('#define SQ(x) ((x)*(x))\nint y = SQ(3);').trim()).toBe(
      'int y = ((3)*(3));'
    );
  });

  it('expands a call with several arguments', () => {
    expect(preprocess('#define ADD(a,b) ((a)+(b))\nint y = ADD(1,2);').trim()).toBe(
      'int y = ((1)+(2));'
    );
  });

  it('keeps commas inside nested parentheses in one argument', () => {
    const out = preprocess('#define ID(x) (x)\nint y = ID(f(1,2));');
    expect(out.trim()).toBe('int y = (f(1,2));');
  });

  it('accepts a definition split over lines with a backslash', () => {
    const out = preprocess('#define ADD(a,b) \\\n  ((a)+(b))\nint y = ADD(5,6);');
    expect(out.split('\n').length).toBe(3); // line numbering preserved
    expect(out.trim()).toBe('int y = ((5)+(6));');
  });

  it('leaves the name alone when it is not called', () => {
    expect(preprocess('#define SQ(x) ((x)*(x))\nint SQ = 1;').trim()).toBe(
      'int SQ = 1;'
    );
  });

  it('does not recurse forever on a self-referential macro', () => {
    expect(preprocess('#define N (N+1)\nint x = N;').trim()).toBe('int x = (N+1);');
  });
});

describe('stringification and token pasting', () => {
  it('turns #param into a string literal of the raw argument', () => {
    expect(preprocess('#define STR(x) #x\nputs(STR(abc));').trim()).toBe(
      'puts("abc");'
    );
  });

  it('squeezes whitespace in the stringified argument', () => {
    expect(preprocess('#define STR(x) #x\nputs(STR( a   b ));').trim()).toBe(
      'puts("a b");'
    );
  });

  it('stringifies the argument unexpanded, as C does', () => {
    const out = preprocess('#define N 7\n#define STR(x) #x\nputs(STR(N));');
    expect(out.trim()).toBe('puts("N");');
  });

  it('escapes quotes and backslashes', () => {
    const out = preprocess('#define STR(x) #x\nputs(STR("a\\n"));');
    expect(out.trim()).toBe('puts("\\"a\\\\n\\"");');
  });

  it('pastes two operands into one token', () => {
    expect(preprocess('#define CAT(a,b) a##b\nint y = CAT(x,z);').trim()).toBe(
      'int y = xz;'
    );
  });

  it('pastes without expanding either operand first', () => {
    const out = preprocess('#define N 7\n#define CAT(a,b) a##b\nint y = CAT(N,N);');
    expect(out.trim()).toBe('int y = NN;');
  });

  it('expands the result of a paste when it names a macro', () => {
    const out = preprocess('#define xy 4\n#define CAT(a,b) a##b\nint y = CAT(x,y);');
    expect(out.trim()).toBe('int y = 4;');
  });

  it('leaves a # that is not followed by a parameter alone', () => {
    expect(preprocess('#define HASH(x) # y\nint a = HASH(1);').trim()).toBe(
      'int a = # y;'
    );
  });
});

describe('variadic macros', () => {
  it('passes every argument through __VA_ARGS__', () => {
    const out = preprocess('#define LOG(...) printf(__VA_ARGS__)\nLOG("%d", 3);');
    expect(out.trim()).toBe('printf("%d", 3);');
  });

  it('combines named parameters with the variable part', () => {
    const out = preprocess(
      '#define LOG(fmt, ...) printf(fmt, __VA_ARGS__)\nLOG("%d %d", 1, 2);'
    );
    expect(out.trim()).toBe('printf("%d %d", 1, 2);');
  });

  it('expands macros inside the variable arguments', () => {
    const out = preprocess(
      '#define N 7\n#define LOG(...) printf(__VA_ARGS__)\nLOG("%d", N);'
    );
    expect(out.trim()).toBe('printf("%d", 7);');
  });

  it('drops the comma of `, ##__VA_ARGS__` when nothing was passed', () => {
    const out = preprocess(
      '#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)\nLOG("hi");'
    );
    expect(out.trim()).toBe('printf("hi");');
  });

  it('keeps the comma when variable arguments are present', () => {
    const out = preprocess(
      '#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)\nLOG("%d", 3);'
    );
    expect(out.trim()).toBe('printf("%d", 3);');
  });

  it('stringifies the whole variable part', () => {
    const out = preprocess('#define SHOW(...) puts(#__VA_ARGS__)\nSHOW(a, b);');
    expect(out.trim()).toBe('puts("a, b");');
  });

  it('accepts a call with no variable arguments at all', () => {
    const out = preprocess('#define F(...) g(__VA_ARGS__)\nF();');
    expect(out.trim()).toBe('g();');
  });

  it('rejects too few arguments for the named parameters', () => {
    const out = preprocess('#define LOG(fmt, ...) printf(fmt)\nLOG();');
    expect(out.trim()).toBe('LOG();');
  });
});

describe('conditional directives', () => {
  it('keeps the taken branch and drops the other one', () => {
    const out = lines('#define F 1\n#ifdef F\nint a = 1;\n#else\nint b = 2;\n#endif');
    expect(out[2].trim()).toBe('int a = 1;');
    expect(out[4].trim()).toBe('');
  });

  it('honours #ifndef', () => {
    const out = lines('#define F 1\n#ifndef F\nint a = 1;\n#endif\nint b = 2;');
    expect(out[2].trim()).toBe('');
    expect(out[4].trim()).toBe('int b = 2;');
  });

  it('drops text that would not even parse under #if 0', () => {
    const out = lines('#if 0\nthis is not C ;;;\n#endif\nint x = 1;');
    expect(out[1].trim()).toBe('');
    expect(out[3].trim()).toBe('int x = 1;');
  });

  it('evaluates arithmetic and defined() in #if', () => {
    const out = lines('#define N 3\n#if N > 2 && defined(N)\nint a = 1;\n#endif');
    expect(out[2].trim()).toBe('int a = 1;');
  });

  it('takes the #elif branch when the first test fails', () => {
    const out = lines('#if 0\nint a = 1;\n#elif 1\nint b = 2;\n#else\nint c = 3;\n#endif');
    expect(out[1].trim()).toBe('');
    expect(out[3].trim()).toBe('int b = 2;');
    expect(out[5].trim()).toBe('');
  });

  it('keeps nested conditionals inside an excluded block excluded', () => {
    const out = lines('#if 0\n#if 1\nint a = 1;\n#endif\n#endif\nint b = 2;');
    expect(out[2].trim()).toBe('');
    expect(out[5].trim()).toBe('int b = 2;');
  });
});

describe('line numbering', () => {
  it('keeps one output line per input line', () => {
    const code = '#include<stdio.h>\n#define N 3\n\nint main(){\n  return N;\n}';
    expect(preprocess(code).split('\n').length).toBe(code.split('\n').length);
  });

  it('puts the directive lines back as blanks', () => {
    const out = lines('#include<stdio.h>\nint x = 1;');
    expect(out[0]).toBe('');
    expect(out[1]).toBe('int x = 1;');
  });

  it('expands __LINE__ to the line it appears on', () => {
    expect(lines('int a = 1;\nint b = __LINE__;')[1]).toBe('int b = 2;');
  });
});
