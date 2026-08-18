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
 * `--plivet` runs the same probes through src/interpreter/preprocess.ts, the
 * pass PLIVET substitutes for the one above, so the two matrices can be
 * compared directly. It leaves no directives behind, which makes the stock pass
 * a no-op, so the interpreter can be driven unchanged.
 *
 * Usage:
 *   node baseline/scripts/probe-preprocessor.js            # every probe, stock
 *   node baseline/scripts/probe-preprocessor.js --plivet   # every probe, fixed
 *   node baseline/scripts/probe-preprocessor.js --json     # machine readable
 *   node baseline/scripts/probe-preprocessor.js --only P05 # one probe
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
    expect: 'any number',
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

/** Compiles and loads src/interpreter/preprocess.ts through the project babel. */
function loadPlivetPreprocess() {
  const babel = require(path.join(__dirname, '..', '..', 'node_modules', '@babel', 'core'));
  const source = path.join(__dirname, '..', '..', 'src', 'interpreter', 'preprocess.ts');
  const { code } = babel.transformFileSync(source, {
    cwd: path.join(__dirname, '..', '..'),
    filename: source,
    presets: [[require.resolve('@babel/preset-typescript'), { isTSX: false }]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    babelrc: false,
    configFile: false,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', code)(module, module.exports, require);
  return module.exports.preprocess;
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
    return { verdict: 'CRASH', detail: (res.stderr || res.stdout || '').trim().split('\n')[0] };
  }
}

function child() {
  let code = require('fs').readFileSync(0, 'utf8');
  const log = console.log;
  console.log = () => {}; // the engine dumps every stack frame it builds
  const out = (payload) => log(JSON.stringify(payload));
  let interpreter;
  try {
    const { CPP14Interpreter } = require(path.join(
      __dirname, '..', '..', 'node_modules', 'unicoen.ts',
      'dist', 'interpreter', 'CPP14', 'CPP14Interpreter'
    ));
    interpreter = new CPP14Interpreter();
    interpreter.setFileList(new Map());
  } catch (e) {
    return out({ verdict: 'CRASH', detail: 'cannot load interpreter: ' + e.message });
  }
  if (process.argv.includes('--plivet')) {
    try {
      code = loadPlivetPreprocess()(code);
      // PlivetCPP14Interpreter overrides preProcess, it does not run after it.
      // Without this the stock scan still sees the source and can still hang.
      interpreter.preProcess = (text) => text;
    } catch (e) {
      return out({ verdict: 'CRASH', detail: 'preprocess pass failed: ' + e.message });
    }
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
        return out({ verdict: 'STDIN', detail: 'program blocked on input', syntaxErrors });
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

function main() {
  if (process.argv.includes('--child')) return child();
  const only = (() => {
    const i = process.argv.indexOf('--only');
    return i === -1 ? null : process.argv[i + 1];
  })();
  const wanted = only ? probes.filter((p) => p.id === only) : probes;
  const results = wanted.map((p) => {
    const r = runChild(p.code);
    return { id: p.id, title: p.title, expect: p.expect, ...r };
  });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  for (const r of results) {
    const got =
      r.verdict === 'RAN'
        ? JSON.stringify(r.stdout)
        : `${r.verdict}${r.detail ? ' - ' + r.detail : ''}`;
    console.log(`${r.id}  ${r.title}`);
    console.log(`     expect ${JSON.stringify(r.expect)}  got ${got}`);
    if (r.syntaxErrors && r.syntaxErrors.length) {
      console.log(`     syntax: ${r.syntaxErrors.slice(0, 2).join(' | ')}`);
    }
  }
}

main();
