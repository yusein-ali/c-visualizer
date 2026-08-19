/*
 * PLIVET - C preprocessor capability probe.
 *
 * PLIVET has no real preprocessor. Everything it does with directives lives in
 * CPP14Interpreter.preProcess (unicoen.ts 0.5.0): it scans for `#define` lines,
 * takes token[1] as a key and the rest of the line as a value, and then does
 *
 *     text = text.split(key).join(value)
 *
 * over the whole source - a substring replace, not a token-aware macro
 * expansion. Every other directive is left in the text for the grammar to skip.
 *
 * This script probes that behaviour feature by feature so the support matrix is
 * measured rather than assumed. Each probe runs in its own child process with a
 * timeout, because at least one input makes preProcess loop forever: a `#define`
 * line with fewer than three tokens hits `continue` without advancing the scan
 * position. In the browser that freezes the tab, so do not paste those probes
 * into PLIVET - run them here.
 *
 * `--plivet` runs the same probes through PlivetCPP14Interpreter instead - the
 * class the application actually uses, with its own preprocessor pass and its
 * own printf - so the two matrices can be compared directly. The TypeScript is
 * compiled on the fly with babel; no build step is needed.
 *
 * Usage:
 *   node baseline/scripts/probe-preprocessor.js            # every probe, stock
 *   node baseline/scripts/probe-preprocessor.js --plivet   # every probe, fixed
 *   node baseline/scripts/probe-preprocessor.js --json     # machine readable
 *   node baseline/scripts/probe-preprocessor.js --only P05 # one probe
 *   node baseline/scripts/probe-preprocessor.js --map f.c   # what it replaced
 *
 * With --plivet it exits non-zero if an in-scope probe fails, so it can be run
 * as a check. Probes marked `scope: 'out'` are features deliberately not
 * implemented; they are reported as SKIP and never fail the run.
 *
 * Requires node_modules (unicoen.ts, @babel/core). No browser, no build.
 */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const TIMEOUT_MS = 8000;
const MAX_STEPS = 20000;

const probes = [
  {
    id: 'P01',
    title: 'object-like macro in an expression',
    expect: '7',
    code: `#include<stdio.h>
#define N 7
int main(){ printf("%d\\n", N); return 0; }`,
  },
  {
    id: 'P02',
    title: 'object-like macro as an array size',
    expect: '3',
    code: `#include<stdio.h>
#define SIZE 3
int main(){ int a[SIZE]; int i; for(i=0;i<SIZE;i++) a[i]=i; printf("%d\\n", SIZE); return 0; }`,
  },
  {
    id: 'P03',
    title: 'macro referring to another macro (nested expansion)',
    expect: '10',
    code: `#include<stdio.h>
#define TWO 2
#define FIVE 5
#define TEN (TWO*FIVE)
int main(){ printf("%d\\n", TEN); return 0; }`,
  },
  {
    id: 'P04',
    title: 'parenthesised macro value protects precedence',
    expect: '20',
    code: `#include<stdio.h>
#define SUM (6+4)
int main(){ printf("%d\\n", SUM*2); return 0; }`,
  },
  {
    id: 'P05',
    title: 'flag #define with no value (#define DEBUG)',
    expect: 'ok',
    code: `#include<stdio.h>
#define DEBUG
int main(){ printf("ok\\n"); return 0; }`,
  },
  {
    id: 'P06',
    title: 'function-like macro called with the declared parameter name',
    expect: '25',
    code: `#include<stdio.h>
#define SQ(x) ((x)*(x))
int main(){ int x = 5; printf("%d\\n", SQ(x)); return 0; }`,
  },
  {
    id: 'P07',
    title: 'function-like macro called with any other argument',
    expect: '9',
    code: `#include<stdio.h>
#define SQ(x) ((x)*(x))
int main(){ printf("%d\\n", SQ(3)); return 0; }`,
  },
  {
    id: 'P08',
    title: '#ifdef / #endif around a statement',
    expect: 'on',
    code: `#include<stdio.h>
#define FEATURE 1
int main(){
#ifdef FEATURE
  printf("on\\n");
#endif
  return 0; }`,
  },
  {
    id: 'P09',
    title: '#ifdef / #else must exclude the dead branch',
    expect: 'yes',
    code: `#include<stdio.h>
#define FEATURE 1
int main(){
#ifdef FEATURE
  printf("yes\\n");
#else
  printf("no\\n");
#endif
  return 0; }`,
  },
  {
    id: 'P10',
    title: '#ifndef excludes its body when the macro is defined',
    expect: 'kept',
    code: `#include<stdio.h>
#define FEATURE 1
int main(){
#ifndef FEATURE
  printf("dropped\\n");
#endif
  printf("kept\\n");
  return 0; }`,
  },
  {
    id: 'P11',
    title: '#if 0 must exclude even code that would not compile',
    expect: 'alive',
    code: `#include<stdio.h>
int main(){
#if 0
  this is not C at all ;;;
#endif
  printf("alive\\n");
  return 0; }`,
  },
  {
    id: 'P12',
    title: '#undef stops later expansion',
    expect: 'N',
    code: `#include<stdio.h>
#define N 7
#undef N
int main(){ printf("N\\n"); return 0; }`,
  },
  {
    id: 'P13',
    title: 'stringification (#x)',
    expect: 'abc',
    code: `#include<stdio.h>
#define STR(x) #x
int main(){ printf("%s\\n", STR(abc)); return 0; }`,
  },
  {
    id: 'P14',
    title: 'token pasting (a ## b)',
    expect: '4',
    code: `#include<stdio.h>
#define CAT(a,b) a##b
int main(){ int xy = 4; printf("%d\\n", CAT(x,y)); return 0; }`,
  },
  {
    id: 'P15',
    title: 'multi-line macro with backslash continuation',
    expect: '11',
    code: `#include<stdio.h>
#define ADD(a,b) \\
  ((a)+(b))
int main(){ printf("%d\\n", ADD(5,6)); return 0; }`,
  },
  {
    id: 'P16',
    title: 'variadic macro (__VA_ARGS__)',
    expect: '3',
    code: `#include<stdio.h>
#define LOG(...) printf(__VA_ARGS__)
int main(){ LOG("%d\\n", 3); return 0; }`,
  },
  {
    id: 'P17',
    title: 'predefined __LINE__',
    expect: '2',
    code: `#include<stdio.h>
int main(){ printf("%d\\n", __LINE__); return 0; }`,
  },
  {
    id: 'P18',
    title: 'macro name inside a string literal must NOT be replaced',
    expect: 'N=7',
    code: `#include<stdio.h>
#define N 7
int main(){ printf("N=%d\\n", N); return 0; }`,
  },
  {
    id: 'P19',
    title: 'macro name as a substring of an identifier must NOT be replaced',
    expect: '7 1',
    code: `#include<stdio.h>
#define N 7
int main(){ int Now = 1; printf("%d %d\\n", N, Now); return 0; }`,
  },
  {
    id: 'P20',
    title: 'macro name inside a comment must not break the code',
    expect: '7',
    code: `#include<stdio.h>
#define N 7
int main(){ /* N is the size */ printf("%d\\n", N); return 0; }`,
  },
  {
    id: 'P21',
    title: '#include <stdlib.h> (malloc)',
    expect: '42',
    code: `#include<stdio.h>
#include<stdlib.h>
int main(){ int* p = malloc(sizeof(int)); *p = 42; printf("%d\\n", *p); return 0; }`,
  },
  {
    id: 'P22',
    title: '#include <string.h> (strlen)',
    expect: '3',
    code: `#include<stdio.h>
#include<string.h>
int main(){ char s[4] = "abc"; printf("%d\\n", (int)strlen(s)); return 0; }`,
  },
  {
    id: 'P23',
    title: '#include <math.h> (sqrt)',
    expect: '3',
    code: `#include<stdio.h>
#include<math.h>
int main(){ printf("%d\\n", (int)sqrt(9.0)); return 0; }`,
  },
  {
    id: 'P16b',
    title:
      'variadic macro called with no variable arguments (`, ##__VA_ARGS__`)',
    expect: 'done',
    code: `#include<stdio.h>
#define LOG(fmt, ...) printf(fmt, ##__VA_ARGS__)
int main(){ LOG("done\\n"); return 0; }`,
  },
  {
    id: 'P28',
    title: '__VA_OPT__ - C++20 and C23, out of scope for a CPP14 parser',
    scope: 'out',
    expect: 'done',
    code: `#include<stdio.h>
#define LOG(fmt, ...) printf(fmt __VA_OPT__(,) __VA_ARGS__)
int main(){ LOG("done\\n"); return 0; }`,
  },
  {
    id: 'P26',
    title: 'printf("%s") with a string literal, no macros involved',
    expect: 'abc',
    code: `#include<stdio.h>
int main(){ printf("%s\\n", "abc"); return 0; }`,
  },
  {
    id: 'P27',
    title: 'stringification printed with %s - the reason P13 matters',
    expect: 'x + y',
    code: `#include<stdio.h>
#define SHOW(e) printf("%s\\n", #e)
int main(){ SHOW(x + y); return 0; }`,
  },
  {
    id: 'P25',
    title: 'a define directive named in a COMMENT, with nothing after it',
    expect: 'ok',
    code: `#include<stdio.h>
/* mentioning #define
   in prose is enough */
int main(){ printf("ok\\n"); return 0; }`,
  },
  {
    id: 'P24',
    title: '#pragma once is ignored harmlessly',
    expect: 'ok',
    code: `#include<stdio.h>
#pragma once
int main(){ printf("ok\\n"); return 0; }`,
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

/** A probe passes when the program ran and printed exactly what was expected. */
function judge(probe, result) {
  const ok =
    result.verdict === 'RAN' && (result.stdout || '').trim() === probe.expect;
  if (ok) {
    return 'pass';
  }
  return probe.scope === 'out' ? 'out of scope' : 'fail';
}

/** Prints what the preprocessor replaced in a file, the data behind the editor's tooltips. */
function printExpansions(file) {
  const source = require('fs').readFileSync(file, 'utf8');
  const { preprocessSource } = loadTs(
    path.join(__dirname, '..', '..', 'src', 'interpreter', 'preprocess.ts')
  );
  const { expansions } = preprocessSource(source);
  for (const e of expansions) {
    const where = `${String(e.line).padStart(4)}:${String(e.column).padStart(3)}`;
    const detail =
      e.kind === 'macro'
        ? `${e.name} -> ${e.text}` +
          (e.definedAt === undefined ? '' : `   (defined line ${e.definedAt})`)
        : `${e.name} excluded ${e.length} characters`;
    console.log(`${where}  ${e.kind.padEnd(8)} ${detail}`);
  }
  console.log(`\n${expansions.length} replacements`);
}

function main() {
  if (process.argv.includes('--child')) {
    return child();
  }
  const argumentAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? null : process.argv[i + 1];
  };
  const map = argumentAfter('--map');
  if (map !== null) {
    return printExpansions(map);
  }

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
    const label = { pass: 'PASS', fail: 'FAIL', 'out of scope': 'SKIP' };
    for (const r of results) {
      const got =
        r.verdict === 'RAN'
          ? JSON.stringify(r.stdout)
          : `${r.verdict}${r.detail ? ' - ' + r.detail : ''}`;
      console.log(`${label[r.status]}  ${r.id.padEnd(5)} ${r.title}`);
      if (r.status === 'fail') {
        console.log(
          `             expect ${JSON.stringify(r.expect)}  got ${got}`
        );
        if (r.syntaxErrors && r.syntaxErrors.length) {
          // One line is enough to tell a parse failure from a wrong result.
          console.log(
            `             syntax: ${r.syntaxErrors[0].split(' expecting ')[0]}`
          );
        }
      }
    }
    const passed = results.filter((r) => r.status === 'pass').length;
    const skipped = results.filter((r) => r.status === 'out of scope').length;
    const pass = usePlivetPass ? 'PLIVET' : 'stock unicoen.ts';
    console.log(
      `\n${passed}/${results.length - skipped} passing with the ${pass} pass` +
        (skipped ? `, ${skipped} out of scope` : '')
    );
  }

  // Only an in-scope failure is a real one; with the stock pass most of them
  // are, which is the point of keeping that mode.
  const failed = results.filter((r) => r.status === 'fail').length;
  process.exitCode = usePlivetPass && failed > 0 ? 1 : 0;
}

main();
