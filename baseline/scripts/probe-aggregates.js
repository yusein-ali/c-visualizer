/*
 * PLIVET - enum, struct and union capability probe.
 *
 * The sibling of `probe-preprocessor.js`, for the three aggregate types. Each
 * probe is a whole C program with one expected line of output, run in its own
 * child process with a timeout, so a probe that hangs the engine cannot take
 * the suite down with it.
 *
 * What it found the first time it ran, and why the three cases differ:
 *
 *   - `enum` never reaches the engine at all. The grammar has an
 *     `enumspecifier` rule but the mapper has no `visitEnumspecifier`, so
 *     `enum Color { RED, GREEN };` collapses into a `UniVariableDec` whose type
 *     is the literal text "enumColor{RED,GREEN}" and whose variable list is
 *     empty. Using `RED` then ends the run with no output, no syntax error and
 *     no exception.
 *   - `union` parses, but into the same `UniClassDec` a `struct` parses into.
 *     The engine lays the members out one after another, so they do not share
 *     storage and `u.i = 65; u.c` reads 0.
 *   - `struct` mostly works. What breaks is specific: arrays of structs, `+=`
 *     and `++` on a member, an array member inside the struct, a tagless
 *     typedef, and any struct built with malloc.
 *
 * Failure is nearly always silent - the run stops after a step or two with an
 * empty stdout - which is why this measures rather than trusts.
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
 *   node baseline/scripts/probe-aggregates.js            # every probe, stock
 *   node baseline/scripts/probe-aggregates.js --plivet   # through PLIVET's own
 *   node baseline/scripts/probe-aggregates.js --json     # machine readable
 *   node baseline/scripts/probe-aggregates.js --only S09 # one probe
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
const HM = '#include<stdio.h>\n#include<stdlib.h>\n';

const probes = [
  // ---- enum ----------------------------------------------------------------
  {
    id: 'E01',
    title: 'enumerators count from zero',
    expect: '0 1 2',
    code: `${H}enum Color { RED, GREEN, BLUE };
int main(){ printf("%d %d %d\\n", RED, GREEN, BLUE); return 0; }`,
  },
  {
    id: 'E02',
    title: 'an explicit value, and counting on from it',
    expect: '5 6',
    code: `${H}enum E { A = 5, B };
int main(){ printf("%d %d\\n", A, B); return 0; }`,
  },
  {
    id: 'E03',
    title: 'a variable of enum type',
    expect: '1',
    code: `${H}enum Color { RED, GREEN };
int main(){ enum Color c = GREEN; printf("%d\\n", c); return 0; }`,
  },
  {
    id: 'E04',
    title: 'an enumerator as a case label',
    expect: 'green',
    code: `${H}enum Color { RED, GREEN };
int main(){ enum Color c = GREEN;
  switch(c){ case RED: printf("red\\n"); break;
             case GREEN: printf("green\\n"); break; }
  return 0; }`,
  },
  {
    id: 'E05',
    title: 'an enumerator as an array size',
    expect: '3',
    code: `${H}enum { N = 3 };
int main(){ int a[N]; int i; for(i=0;i<N;i++){ a[i]=i; } printf("%d\\n", N); return 0; }`,
  },
  {
    id: 'E06',
    title: 'typedef enum',
    expect: '1',
    code: `${H}typedef enum { OFF, ON } Switch;
int main(){ Switch s = ON; printf("%d\\n", s); return 0; }`,
  },
  {
    id: 'E07',
    title: 'an enum name inside a string is left alone',
    expect: 'RED is 0',
    code: `${H}enum Color { RED };
int main(){ printf("RED is %d\\n", RED); return 0; }`,
  },

  // ---- struct --------------------------------------------------------------
  {
    id: 'S01',
    title: 'declare a struct, set a member, read it back',
    expect: '3 4',
    code: `${H}struct Point { int x; int y; };
int main(){ struct Point p; p.x = 3; p.y = 4; printf("%d %d\\n", p.x, p.y); return 0; }`,
  },
  {
    id: 'S02',
    title: 'brace initialiser',
    expect: '3 4',
    code: `${H}struct Point { int x; int y; };
int main(){ struct Point p = {3, 4}; printf("%d %d\\n", p.x, p.y); return 0; }`,
  },
  {
    id: 'S03',
    title: 'pointer to a struct, and the arrow operator',
    expect: '7',
    code: `${H}struct Point { int x; int y; };
int main(){ struct Point p; struct Point* q = &p; q->x = 7; printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S04',
    title: 'a struct passed by value',
    expect: '7',
    code: `${H}struct Point { int x; int y; };
int sum(struct Point p){ return p.x + p.y; }
int main(){ struct Point p; p.x = 3; p.y = 4; printf("%d\\n", sum(p)); return 0; }`,
  },
  {
    id: 'S05',
    title: 'a struct returned by value',
    expect: '8',
    code: `${H}struct P { int x; };
struct P make(){ struct P p; p.x = 8; return p; }
int main(){ struct P p = make(); printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S06',
    title: 'whole-struct assignment copies the members',
    expect: '6',
    code: `${H}struct P { int x; };
int main(){ struct P a; struct P b; a.x = 6; b = a; printf("%d\\n", b.x); return 0; }`,
  },
  {
    id: 'S07',
    title: 'a struct inside a struct',
    expect: '9',
    code: `${H}struct Inner { int v; };
struct Outer { struct Inner in; };
int main(){ struct Outer o; o.in.v = 9; printf("%d\\n", o.in.v); return 0; }`,
  },
  {
    id: 'S08',
    title: 'a node linked to another with &',
    expect: '1 2',
    code: `${H}struct Node { int v; struct Node* next; };
int main(){ struct Node a; struct Node b; a.v = 1; b.v = 2; a.next = &b;
  printf("%d %d\\n", a.v, a.next->v); return 0; }`,
  },
  {
    id: 'S09',
    title: 'a member changed through a pointer parameter',
    expect: '99',
    code: `${H}struct P { int x; };
void set(struct P* p){ p->x = 99; }
int main(){ struct P p; p.x = 1; set(&p); printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S10',
    title: 'an array of structs',
    expect: '1 2',
    code: `${H}struct Point { int x; int y; };
int main(){ struct Point a[2]; a[0].x = 1; a[1].x = 2;
  printf("%d %d\\n", a[0].x, a[1].x); return 0; }`,
  },
  {
    id: 'S11',
    title: 'compound assignment on a member',
    expect: '2',
    scope: 'todo',
    code: `${H}struct P { int x; };
int main(){ struct P p; p.x = 1; p.x += 1; printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S12',
    title: 'increment on a member',
    expect: '2',
    scope: 'todo',
    code: `${H}struct P { int x; };
int main(){ struct P p; p.x = 1; p.x++; printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S13',
    title: 'an array member inside a struct',
    expect: '3',
    code: `${H}struct S { char name[8]; int n; };
int main(){ struct S s; s.n = 3; printf("%d\\n", s.n); return 0; }`,
  },
  {
    id: 'S14',
    title: 'a tagless typedef struct',
    expect: '5',
    code: `${H}typedef struct { int x; } P;
int main(){ P p; p.x = 5; printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S15',
    title: 'the typedef name of a struct that also has a tag',
    expect: '5',
    code: `${H}typedef struct Pt { int x; } P;
int main(){ P p; p.x = 5; printf("%d\\n", p.x); return 0; }`,
  },
  {
    id: 'S16',
    title: 'a struct on the heap',
    expect: '4',
    scope: 'todo',
    code: `${HM}struct P { int x; };
int main(){ struct P* p = (struct P*)malloc(sizeof(struct P));
  p->x = 4; printf("%d\\n", p->x); return 0; }`,
  },

  // ---- union ---------------------------------------------------------------
  {
    id: 'U01',
    title: 'write a member and read the same one',
    expect: '65',
    code: `${H}union U { int i; char c; };
int main(){ union U u; u.i = 65; printf("%d\\n", u.i); return 0; }`,
  },
  {
    id: 'U02',
    title: 'the members share storage',
    expect: '65',
    code: `${H}union U { int i; char c; };
int main(){ union U u; u.i = 65; printf("%d\\n", u.c); return 0; }`,
  },
  {
    id: 'U03',
    title: 'a union is as wide as its widest member',
    expect: '8',
    code: `${H}union U { char c; double d; };
int main(){ union U u; printf("%d\\n", (int)sizeof(u)); return 0; }`,
  },
  {
    id: 'U04',
    title: 'a union inside a struct',
    expect: '7',
    code: `${H}union U { int i; char c; };
struct S { union U u; int n; };
int main(){ struct S s; s.u.i = 7; printf("%d\\n", s.u.i); return 0; }`,
  },
  {
    id: 'U05',
    title: 'reinterpreting the bytes of a wider member',
    expect: '66',
    scope: 'out',
    code: `${H}union U { int i; char c; };
int main(){ union U u; u.i = 0x4142; printf("%d\\n", u.c); return 0; }`,
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
