# PLIVET <a href="http://doge.mit-license.org"><img src="http://img.shields.io/:license-mit-blue.svg"></a> [![Build Status](https://secure.travis-ci.org/RYOSKATE/PLIVET.svg?branch=master)](http://travis-ci.org/RYOSKATE/PLIVET)

Programming Language Interpreter for Visualization of Execution Trace (PLIVET) is a program interpreter with visualization of execution state.

PLIVET supports the C language.

## For User

PLIVET can be used with most modern browsers.

Our build targets are as follows:

[>0.25%, not ie 11 (Browserslist)](http://browserl.ist/?q=%3E0.25%25%2C+not+ie+11)

### Online

Demo page is here.

[https://ryoskate.github.io/PLIVET](https://ryoskate.github.io/PLIVET)

### Offline

1. Switch to the [gh-pages branch](https://github.com/RYOSKATE/PLIVET/tree/gh-pages).
1. Download this repository.
1. Open `index.html` by a modern browser.

## For Developer

### Required

- node.js v24.15.0 (see `.tool-versions`)
- npm 11 (the only supported package manager; `package-lock.json` is committed)

### Setup environment

- Install node packages

```
npm ci
```

- After editing files in `src/`,

```
npm run build
```

to update `dist/` by webpack.

`npm start` serves the application at `http://localhost:8080/`. The interface is
framework-free: CodeMirror 6 for the editor, JointJS for the memory graph, and
plain DOM for everything around them. React left the tree in Phase 9 of
[UPGRADE_PLAN.md](UPGRADE_PLAN.md).
