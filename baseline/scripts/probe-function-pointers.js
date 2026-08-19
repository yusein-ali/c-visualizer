/*
 * PLIVET - function pointer capability probe.
 *
 * The sibling of `probe-preprocessor.js` and `probe-aggregates.js`. Each probe
 * is a whole C program with one expected line of output, run in its own child
 * process with a timeout, so a probe that hangs the engine cannot take the
 * suite down with it.
 *
 * What it found the first time it ran, against stock unicoen.ts:
 *
 *   - a function pointer never reaches the engine at all. The mapper has no
 *     case for a declarator whose name is parenthesized, so
 *     `int (*op)(int, int) = add;` collapses into three items in the block
 *     body - the bare string "int", an empty `UniExpr` and the string ";" -
 *     and the run stops after one step with no output, no syntax error and no
 *     exception.
 *   - the one spelling that already worked was `typedef int (*B)(int, int);`
 *     followed by `B op = add;`, and only by accident: the mapper cannot parse
 *     the typedef either, but `B` is then an unknown type, `_execCast` leaves
 *     an unknown type alone, and `execMethoodCall` happens to dispatch on
 *     whatever a name resolves to.
 *   - `ops[i](a, b)` and `o.fn(a, b)` are refused one level lower. The first
 *     parses and maps to an empty `UniExpr`; the second is a syntax error.
 *     Both need the source respelled as `(*ops[i])(a, b)` before the mapper
 *     will build a call, which is what PLIVET's pass does.
 *   - a function definition that returns a function pointer,
 *     `int (*pick(int))(int, int)`, is a grammar failure with no way around
 *     it from outside the parser.
 *
 * Probes are marked with the scope they sit in:
 *
 *   in    already works, and has to keep working
 *   todo  in scope, not implemented yet: a failure here is the recorded state
 *   out   deliberately not supported
 *
 * So the suite is green today, and turns loud the moment a `todo` starts
 * passing - that is the signal to move it to `in`.
 *
 * Usage:
 *   node baseline/scripts/probe-function-pointers.js            # stock
 *   node baseline/scripts/probe-function-pointers.js --plivet   # PLIVET's pass
 *   node baseline/scripts/probe-function-pointers.js --json
 *   node baseline/scripts/probe-function-pointers.js --only F09
 *
 * Exits non-zero only when an `in` probe fails - a real regression.
 *
 * Requires node_modules (unicoen.ts, @babel/core). No browser, no build.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const TIMEOUT_MS = 8000;
const MAX_STEPS = 20000;

const H = '#include<stdio.h>\n';
const F =
  H +
  'int add(int a, int b){ return a + b; }\n' +
  'int sub(int a, int b){ return a - b; }\n';

const probes = [
  // ---- declaring and calling ----------------------------------------------
  {
    id: 'F01',
    title: 'declare, initialize and call through a pointer',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int main(){ int (*op)(int, int) = add; printf("%d\\n", op(2, 3)); return 0; }',
  },
  {
    id: 'F02',
    title: 'the address-of spelling of the same initializer',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int main(){ int (*op)(int, int) = &add; printf("%d\\n", op(2, 3)); return 0; }',
  },
  {
    id: 'F03',
    title: 'the dereference spelling of the same call',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int main(){ int (*op)(int, int) = add; printf("%d\\n", (*op)(2, 3)); return 0; }',
  },
  {
    id: 'F04',
    title: 'declare first, assign later',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int main(){ int (*op)(int, int); op = add; printf("%d\\n", op(2, 3)); return 0; }',
  },
  {
    id: 'F05',
    title: 'point at another function',
    scope: 'in',
    expect: '4',
    code:
      F +
      'int main(){ int (*op)(int, int) = add; op = sub; printf("%d\\n", op(7, 3)); return 0; }',
  },
  {
    id: 'F06',
    title: 'a pointer to a function taking and returning nothing',
    scope: 'in',
    expect: 'hi',
    code:
      H +
      'void greet(void){ printf("hi\\n"); }\n' +
      'int main(){ void (*g)(void) = greet; g(); return 0; }',
  },
  {
    id: 'F07',
    title: 'a pointer held in a global',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int (*gop)(int, int) = add;\nint main(){ printf("%d\\n", gop(2, 3)); return 0; }',
  },

  // ---- callbacks -----------------------------------------------------------
  {
    id: 'F08',
    title: 'a function pointer as a parameter',
    scope: 'in',
    expect: '5',
    code:
      F +
      'int apply(int (*f)(int, int), int a, int b){ return f(a, b); }\n' +
      'int main(){ printf("%d\\n", apply(add, 2, 3)); return 0; }',
  },
  {
    id: 'F09',
    title: 'a pointer variable passed on as a callback',
    scope: 'in',
    expect: '4',
    code:
      F +
      'int apply(int (*f)(int, int), int a, int b){ return f(a, b); }\n' +
      'int main(){ int (*op)(int, int) = sub; printf("%d\\n", apply(op, 7, 3)); return 0; }',
  },
  {
    id: 'F10',
    title: 'a typedef of a function-pointer type',
    scope: 'in',
    expect: '5',
    code:
      H +
      'typedef int (*BinOp)(int, int);\nint add(int a, int b){ return a + b; }\n' +
      'int main(){ BinOp op = add; printf("%d\\n", op(2, 3)); return 0; }',
  },

  // ---- dispatch tables -----------------------------------------------------
  {
    id: 'F11',
    title: 'an array of function pointers, called by index',
    scope: 'in',
    expect: '5 4',
    code:
      F +
      'int main(){ int (*ops[2])(int, int) = {add, sub};\n' +
      '  printf("%d %d\\n", ops[0](2, 3), ops[1](7, 3)); return 0; }',
  },
  {
    id: 'F12',
    title: 'the same table, called through an explicit dereference',
    scope: 'in',
    expect: '4',
    code:
      F +
      'int main(){ int (*ops[2])(int, int) = {add, sub};\n' +
      '  printf("%d\\n", (*ops[1])(7, 3)); return 0; }',
  },
  {
    id: 'F13',
    title: 'a function pointer as a struct member',
    scope: 'in',
    expect: '5',
    code:
      F +
      'struct Op { int (*fn)(int, int); };\n' +
      'int main(){ struct Op o; o.fn = add; printf("%d\\n", o.fn(2, 3)); return 0; }',
  },

  // ---- values --------------------------------------------------------------
  {
    id: 'F14',
    title: 'comparing a pointer with the function it points at',
    scope: 'in',
    expect: '1 0',
    code:
      F +
      'int main(){ int (*op)(int, int) = add;\n' +
      '  printf("%d %d\\n", op == add, op == sub); return 0; }',
  },
  {
    id: 'F15',
    title: 'a null check on a callback that was never set',
    scope: 'in',
    expect: 'clear',
    code:
      F +
      'int main(){ int (*op)(int, int) = 0; if (!op) { printf("clear\\n"); } return 0; }',
  },
  {
    id: 'F16',
    title: 'a function is never at the null address',
    scope: 'in',
    expect: '0',
    code:
      F +
      'int main(){ int (*op)(int, int) = add; printf("%d\\n", op == 0); return 0; }',
  },
  {
    id: 'F17',
    title: 'choosing a function with a conditional',
    scope: 'in',
    expect: '10',
    code:
      F +
      'int main(){ int wide = 1; int (*op)(int, int) = wide ? add : sub;\n' +
      '  printf("%d\\n", op(7, 3)); return 0; }',
  },

  // ---- not supported -------------------------------------------------------
  {
    id: 'F18',
    title: 'a function that returns a function pointer',
    scope: 'out',
    expect: '5',
    code:
      F +
      'int (*pick(int wide))(int, int){ return wide ? add : sub; }\n' +
      'int main(){ printf("%d\\n", pick(0)(2, 3)); return 0; }',
  },
  {
    id: 'F19',
    title: 'a typedef of a function type rather than a pointer to one',
    scope: 'out',
    expect: '5',
    code:
      H +
      'int add(int a, int b){ return a + b; }\ntypedef int BinOp(int, int);\n' +
      'int main(){ BinOp *op = add; printf("%d\\n", op(2, 3)); return 0; }',
  },
  {
    id: 'F20',
    title: 'qsort with a comparison callback',
    scope: 'out',
    expect: '1 2 3',
    code:
      H +
      '#include<stdlib.h>\n' +
      'int cmp(const void *a, const void *b){ return *(int *)a - *(int *)b; }\n' +
      'int main(){ int v[3] = {3, 1, 2}; qsort(v, 3, sizeof(int), cmp);\n' +
      '  printf("%d %d %d\\n", v[0], v[1], v[2]); return 0; }',
  },
];

const usePlivetPass = process.argv.includes('--plivet');

const tsCache = new Map();

/** Compiles one src/*.ts with babel, resolving its relative imports the same way. */
function loadTs(file) {
  if (tsCache.has(file)) {
    return tsCache.get(file);
  }
  const babel = require(
    path.join(__dirname, '..', '..', 'node_modules', '@babel', 'core')
  );
  const { code } = babel.transformFileSync(file, {
    filename: file,
    presets: [[require.resolve('@babel/preset-typescript'), {}]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    babelrc: false,
    configFile: false,
  });
  const loaded = { exports: {} };
  tsCache.set(file, loaded.exports);
  const localRequire = (request) =>
    request.startsWith('.')
      ? loadTs(path.resolve(path.dirname(file), request) + '.ts')
      : require(request);
  new Function('module', 'exports', 'require', code)(
    loaded,
    loaded.exports,
    localRequire
  );
  tsCache.set(file, loaded.exports);
  return loaded.exports;
}

/** The interpreter the application itself uses, compiled from src/. */
function loadPlivetInterpreter() {
  const entry = path.join(
    __dirname,
    '..',
    '..',
    'src',
    'interpreter',
    'CPP14.ts'
  );
  return loadTs(entry).PlivetCPP14Interpreter;
}

function runChild(code) {
  const res = spawnSync(
    process.execPath,
    [__filename, '--child'].concat(usePlivetPass ? ['--plivet'] : []),
    { input: code, encoding: 'utf8', timeout: TIMEOUT_MS }
  );
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return { verdict: 'HANG', detail: `no result within ${TIMEOUT_MS} ms` };
  }
  if (res.signal) {
    return { verdict: 'HANG', detail: `killed by ${res.signal}` };
  }
  try {
    return JSON.parse(res.stdout.trim().split('\n').pop());
  } catch (e) {
    return {
      verdict: 'CRASH',
      detail: (res.stderr || res.stdout || '').trim().split('\n')[0],
    };
  }
}

function child() {
  const code = require('fs').readFileSync(0, 'utf8');
  const log = console.log;
  console.log = () => {}; // the engine dumps every stack frame it builds
  const out = (payload) => log(JSON.stringify(payload));
  let interpreter;
  try {
    if (process.argv.includes('--plivet')) {
      const PlivetInterpreter = loadPlivetInterpreter();
      interpreter = new PlivetInterpreter();
    } else {
      const { CPP14Interpreter } = require(
        path.join(
          __dirname,
          '..',
          '..',
          'node_modules',
          'unicoen.ts',
          'dist',
          'interpreter',
          'CPP14',
          'CPP14Interpreter'
        )
      );
      interpreter = new CPP14Interpreter();
    }
    interpreter.setFileList(new Map());
  } catch (e) {
    return out({
      verdict: 'CRASH',
      detail: 'cannot load interpreter: ' + e.message,
    });
  }
  let syntaxErrors = [];
  try {
    syntaxErrors = interpreter.checkSyntaxError(code).map((e) => e.getMsg());
  } catch (e) {
    syntaxErrors = ['checkSyntaxError threw: ' + e.message];
  }
  try {
    interpreter.startStepExecution(code);
    let steps = 0;
    while (interpreter.isStepExecutionRunning() && steps < MAX_STEPS) {
      if (interpreter.getIsWaitingForStdin()) {
        return out({
          verdict: 'STDIN',
          detail: 'program blocked on input',
          syntaxErrors,
        });
      }
      interpreter.stepExecute();
      steps++;
    }
    return out({
      verdict: steps >= MAX_STEPS ? 'STEP-LIMIT' : 'RAN',
      stdout: interpreter.getStdout(),
      steps,
      syntaxErrors,
    });
  } catch (e) {
    return out({ verdict: 'THREW', detail: e && e.message, syntaxErrors });
  }
}

/**
 * A probe passes when the program ran and printed exactly what was expected.
 * A `todo` that fails is the recorded state, not a regression; a `todo` that
 * passes is news.
 */
function judge(probe, result) {
  const ok =
    result.verdict === 'RAN' && (result.stdout || '').trim() === probe.expect;
  if (ok) {
    return probe.scope === 'todo' ? 'now passing' : 'pass';
  }
  if (probe.scope === 'out') {
    return 'out of scope';
  }
  return probe.scope === 'todo' ? 'not yet' : 'fail';
}

function main() {
  if (process.argv.includes('--child')) {
    return child();
  }
  const argumentAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? null : process.argv[i + 1];
  };

  const only = argumentAfter('--only');
  const wanted = only ? probes.filter((p) => p.id === only) : probes;
  const results = wanted.map((probe) => {
    const result = runChild(probe.code);
    return {
      id: probe.id,
      title: probe.title,
      expect: probe.expect,
      scope: probe.scope || 'in',
      status: judge(probe, result),
      ...result,
    };
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const label = {
      pass: 'PASS',
      fail: 'FAIL',
      'not yet': 'TODO',
      'now passing': 'NEW ',
      'out of scope': 'SKIP',
    };
    for (const r of results) {
      const got =
        r.verdict === 'RAN'
          ? JSON.stringify(r.stdout)
          : `${r.verdict}${r.detail ? ' - ' + r.detail : ''}`;
      console.log(`${label[r.status]}  ${r.id.padEnd(5)} ${r.title}`);
      if (r.status === 'fail' || r.status === 'not yet') {
        console.log(
          `             expect ${JSON.stringify(r.expect)}  got ${got}`
        );
        if (r.syntaxErrors && r.syntaxErrors.length) {
          console.log(
            `             syntax: ${r.syntaxErrors[0].split(' expecting ')[0]}`
          );
        }
      }
    }
    const count = (status) => results.filter((r) => r.status === status).length;
    const inScope = results.filter((r) => r.scope === 'in').length;
    const pass = usePlivetPass ? 'PLIVET' : 'stock unicoen.ts';
    console.log(
      `\n${count('pass')}/${inScope} working with the ${pass} pass, ` +
        `${count('not yet')} not implemented yet, ` +
        `${count('out of scope')} out of scope`
    );
    if (count('now passing') > 0) {
      console.log(
        `${count('now passing')} probe(s) marked todo are now passing - ` +
          `move them to scope 'in'.`
      );
    }
  }

  // Only a probe that used to work and stopped is a real failure.
  process.exitCode =
    results.filter((r) => r.status === 'fail').length > 0 ? 1 : 0;
}

main();
