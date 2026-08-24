/**
 * Every piece of text the interface shows, in one table. c-visualizer is
 * English-only: there is no locale to select and no translation layer to go
 * through, so a widget reads the string it needs straight off this object.
 */
const strings = {
  howToUse: 'How to use',
  close: 'Close',
  tabsLabel: 'Open files',
  tabRuns: 'this is the entry source file',
  tabMakeEntry: 'make this the entry source file',
  tabEntryHint: 'The filled triangle marks this as the entry source file',
  tabMakeEntryHint:
    'Press the hollow triangle to make this the entry source file',
  tabClose: 'Close',
  openCode: 'Load',
  openCodeHint: 'Load a C source file, or a session saved from here',
  saveCode: 'Save',
  saveCodeHint: 'Save the active source as a C source file',
  buildCode: 'Build',
  buildCodeHint:
    'Check all source files with the configured compiler and show its diagnostics',
  openedNotCode: 'That file could not be read as a program.',
  savedFileName: 'program.c',
  preprocessedButton: 'Preprocessed',
  preprocessedTitle: 'Source after preprocessing',
  preprocessedHint:
    'Compare the written source with the preprocessing tokens left after macro replacement and conditional inclusion. This view is read-only.',
  debugStatus: 'DebugStatus',
  debugToolbar: 'Debug toolbar',
  moveDebugToolbar:
    'Move debug toolbar. Use arrow keys to move it and Enter to reset it.',
  step: 'Step',
  theme: 'theme',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
  debugStart: 'restart step execution',
  debugStop: 'stop execution',
  debugBackAll: 'go backward for all steps',
  debugStepBack: 'step backward',
  debugStepOver: 'step over function calls (F7)',
  debugStep: 'step into (F6)',
  debugStepAll: 'continue (F5)',
  // Before a session exists the double arrow starts one and runs it; the
  // button had no title at all in that state.
  debugExec: 'run to the first breakpoint (F5)',
  zoomOut: 'change the font size to smaller.',
  zoomIn: 'change the font size to larger.',
  zoomReset: 'reset the font size',
  graphZoomOut: 'Zoom out',
  graphZoomIn: 'Zoom in',
  graphZoomReset: 'Reset graph zoom',
  resizeColumns: 'Drag to resize the editor and the canvas',
  resizeEditor: 'Drag to resize the editor',
  resizeCanvas: 'Drag to resize the canvas',
  graphViewOptions: 'View',
  graphViewOptionsTitle: 'Choose what the canvas draws',
  graphViewRegions: 'Implementation memory regions',
  graphViewSections: 'Sections',
  // The state views consolidated into the canvas workspace.
  viewCallStack: 'Call stack',
  viewVariables: 'Variables',
  viewMutations: 'Object writes over time',
  viewNothingRunning: 'no function invocation is active',
  viewNothingWritten: 'no object has been written yet',
  viewCalledFrom: 'called from line',
  viewCalledFromFile: 'called from',
  viewLine: 'line',
  viewColumnFrame: 'Function invocation',
  viewColumnObject: 'Object',
  viewColumnBefore: 'Previously stored',
  viewColumnAfter: 'Stored after write',
  viewColumnLine: 'Line',
  graphViewStatement: 'Statement',
  // The diagnostics band: what the local checker and the host's compiler have
  // said about the program, in one table over the state views.
  graphViewDiagnostics: 'Diagnostics',
  diagnosticsHeading: 'Diagnostic output',
  diagnosticsColumnSeverity: 'Severity',
  diagnosticsColumnSource: 'Source',
  diagnosticsColumnFile: 'File',
  diagnosticsColumnLine: 'Line',
  diagnosticsColumnType: 'Type',
  diagnosticsSeverityError: 'Error',
  diagnosticsSeverityWarning: 'Warning',
  diagnosticsSeverityInfo: 'Info',
  diagnosticsSourceLocal: 'Local',
  diagnosticsSourceBuild: 'Build',
  diagnosticsLocalRunning: 'Local validation running',
  diagnosticsLocalComplete: 'Local validation complete',
  diagnosticsBuildStarted: 'Build started',
  diagnosticsBuildComplete: 'Build complete',
  diagnosticsDebugging: 'Debug status',
  diagnosticsRunRejected: 'Run rejected because the program has errors',
  diagnosticsRunRejectedAt: 'Run rejected at',
  labelUnsupported:
    'a labelled statement cannot be stepped, so this program cannot use ' +
    "'goto'",
  gotoUnsupported: "'goto' cannot be stepped",
  shiftAssignUnsupported:
    "'>>=' cannot be stepped; write it as 'x = x >> n'",
  diagnosticsRunStoppedOnError: 'Run stopped because of a runtime error',
  diagnosticsRunStoppedAt: 'Execution stopped at',
  diagnosticsRunInvalidStatement: 'because the statement is not valid.',
  diagnosticsIdle: 'Diagnostics idle',
  memoryRegisters: 'register-class objects',
  memoryText: 'Function code (text)',
  memoryReadOnly: 'Read-only storage model',
  memoryData: 'Initialized static storage (data)',
  memoryBss: 'Zero-initialized static storage (BSS)',
  memoryHeap: 'Allocated storage (heap)',
  memoryStack: 'Automatic storage (stack)',
  memoryColumnAddress: 'Address',
  memoryColumnName: 'Name',
  memoryColumnValue: 'Value',
  memoryEmptySegment: 'empty at this step',
  variableContextFile: 'File',
  variableContextFunction: 'Function',
  variableColumnSize: 'Size',
  variableColumnSegment: 'Memory segment',
  variableColumnType: 'Type',
  variableNoContext: 'none',
  variableNoneActive: 'no active variables in this context',
  // The JointJS sections, read as cause then state: the operation and active
  // call, its expression, and what the program holds after it.
  graphMemoryHeading: 'Memory',
  graphStatementHeading: 'Statement',
  graphExpressionHeading: 'Expression expansion',
  // A call's own expansion is headed by the callee and the parameters its
  // arguments fill, so the tree below reads as a call rather than an operator.
  graphCallHeading: 'Call',
  expressionCurrentValue: 'Current value',
  statementNotRunning: 'no statement is being executed',
  statementCurrent: 'Current statement',
  statementNoActive: 'No current statement',
  statementContextFile: 'File',
  statementContextLine: 'Line',
  statementContextFunction: 'Function',
  statementOnLine: 'At line:',
  statementLoopExitedOnLine:
    'Iteration statement completed after its controlling expression on line',
  // The same fact said beside the statement the marker is actually on, where
  // the loop that just ended is a note about how control got here rather than
  // the thing being explained.
  statementLoopAlsoEnded: 'completed: its controlling expression evaluated to',
  statementStartHint:
    'Start or step through the program to see what the current statement does.',
  statementWith: 'with',
  statementAnd: 'and',
  statementWhich: 'which',
  statementControllingExpression: 'Its controlling expression',
  statementReadsNonzero:
    'The scalar value compares unequal to 0, so C treats it as true',
  statementReadsZero:
    'The scalar value compares equal to 0, so C treats it as false',
  statementValuesHeading: 'Values produced so far',
  howToIntro:
    'c-visualizer runs and visualizes C programs entirely in your browser. Start with the editor, then use the controls to move through the program and inspect what each statement does.',
  howToAttribution: {
    title: 'Attribution and disclaimer',
    plivetBefore: 'c-visualizer is an independently developed fork of ',
    plivetLink: 'PLIVET',
    plivetAfter:
      ' by RYOSKATE, distributed under the MIT License. It is not an official PLIVET release.',
    thesisBefore: 'Its educational and research context includes ',
    thesisLink: "Veli-Matti Rantanen's 2023 Aalto University master's thesis",
    thesisAfter:
      ', “An Interactive C Code Execution and Visualization Tool for Online Learning,” supervised by Prof. Riku Jäntti and advised by Dr. Yusein Ali.',
    current:
      'The current version is developed by Yusein R. Ali at Aalto University. These references state the project’s provenance and do not imply endorsement by Aalto University or the original PLIVET maintainers.',
  },
  howToSections: [
    {
      title: 'Write and understand the program',
      items: [
        'Write C in the editor or choose Load to add a C source file. After you pause typing, the editor checks the entry source and marks syntax errors, runtime diagnostics, and teaching suggestions; some suggestions include a one-click fix.',
        'Completions offer C language constructs, identifiers declared in the program, and common library functions.',
        'Use the fold gutter to collapse compound statements. Macro replacements, preprocessing directives, and source excluded by conditional inclusion are marked in the editor; choose Preprocessed to compare the written source with the preprocessing result.',
        'In an exercise, only the regions chosen by its author may be editable. c-visualizer keeps the rest of the program fixed.',
      ],
    },
    {
      title: 'Use editor tooltips',
      items: [
        'Pause the pointer over a name or marked part of the source to open its tooltip. A tooltip describes the smallest relevant item under the pointer, so hovering an operator or subexpression can give a more specific answer than hovering the surrounding statement.',
        'Before execution, tooltips explain declarations and C language constructs. They can show types, type qualifiers, storage-class specifiers, parameters, control-flow clauses, conversions, and where a break, continue, or return statement transfers control. Common library functions show a declaration and a short description.',
        'At a debug step, an object tooltip shows its declared type, stored value, and address; a pointer value also shows the object it points to and that object’s value. Tooltips on the current expression show results already produced, and control-flow tooltips explain controlling-expression values, selected branches, iteration counts, arguments, and return values for that step.',
        'Preprocessor tooltips show macro-replacement chains and definition lines, whether a conditional-inclusion group is active, and which source was excluded. Hover over an error or teaching marker to read the diagnostic and any available library help or suggested fix.',
        'Hovering an object identifier also highlights the matching declaration and object row on the canvas. Alt-click an identifier to pin its tooltip as a live watch; Alt-click it again to remove the watch. A pinned watch updates at every step and reports when the identifier is not visible at the current execution point.',
      ],
    },
    {
      title: 'Run and step through it',
      items: [
        'Click the breakpoint gutter to set or remove a breakpoint. Continue stops at the next breakpoint, request to read from the standard input stream, or program termination.',
        'The seven execution buttons, from left to right, restart, stop, rewind to the first recorded step, step backward, step over function calls, step forward, and continue. Before a session starts, the two forward buttons start stepping or run to the first breakpoint.',
        'During a session the source is read-only. The editor highlights the current statement, shows relevant values beside it, shades lines by how often they ran, and the status displays the current step. Stop to edit the source again.',
        'Backward controls replay recorded history; they do not execute C in reverse. Restart begins again with the current source and breakpoints.',
      ],
    },
    {
      title: 'Read input and output',
      items: [
        'Characters written to the standard output stream by functions such as printf appear below the editor. When a function such as scanf waits to read from the standard input stream, the input field becomes available and receives focus.',
        'Press Enter to supply the input, or Shift+Enter to add another line before supplying it. Execution continues until the program next waits for standard input, reaches a breakpoint, or terminates.',
      ],
    },
    {
      title: 'Explore the visualization',
      items: [
        'The canvas is arranged from operation to state: Statement and Call stack appear first, Expression expansion follows them, Variables summarizes the active file and function context, Memory shows the resulting program state, and Object writes over time records the stores that produced it.',
        'Statement names the current C language construct and source line, then explains what it is doing. Depending on the step, it shows clauses, controlling-expression results, the selected branch, assignment expressions, arguments, return values, conversions, and expression results produced so far. A switch statement lists its case and default labels; after its controlling expression is evaluated, the explanation identifies the matching label and reports observed fall-through from an earlier label.',
        'Call stack lists active function invocations with the current invocation first. Each entry can show the source line containing the call, each argument value assigned to its corresponding parameter, and the number of active invocations of a recursive function.',
        'Expression expansion draws the active expression as a tree of operands and operators. Each available result appears in its own Current value strip, making the interpreter’s evaluation order and intermediate results visible.',
        'Each argument expression is drawn beneath its function-call operator and annotated with the corresponding parameter. When a statement contains a nested call with a computed argument, that call is also drawn below the main expansion, rooted at the function-call operator and headed by the function declaration. These sections follow the Expression expansion switch and each collapses on its own heading.',
        'Variables is a debugger-style table for the current file and function. It lists file-scope objects and objects in the executing function by name and value, together with each object’s implementation-model memory segment and address. Variables in suspended caller frames remain visible in Memory and Call stack rather than appearing in the current function’s table.',
        'Memory is the visualizer’s implementation model of the program’s address space; C does not require these regions. Every object row shows its address, identifier, stored value, type, and size when available. Pointer arrows start at pointer values and end at the objects they point to; array elements, structure and union members, and pointed-to objects can be expanded as subobjects.',
        'The register-class objects region contains objects declared with the register storage-class specifier; C does not require such an object to occupy a processor register. Automatic storage (stack) contains parameters and other objects with automatic storage duration, grouped by active function invocation. Allocated storage (heap) contains storage returned by allocation functions such as malloc.',
        'Initialized static storage and Zero-initialized static storage (BSS) are implementation-model regions for writable objects with static storage duration. Read-only storage model contains const-qualified objects with static storage duration and string literals. Function code (text) represents program function definitions, the supported stdio routines referenced by the program, and their illustrative addresses. Program-function sizes are estimates of 16 bytes per parsed expression, with a 16-byte minimum per function; runtime-backed stdio routines use the 16-byte minimum. These are not compiled object-code sizes.',
        'Object writes over time lists stores newest first. Its columns identify the function invocation and object, the stored values before and after the write, and the responsible source line.',
        'Hover over an object identifier in either the editor or canvas to highlight the matching declaration and object row. Pointer arrows and matching highlights connect a source-level identifier to the object represented in memory.',
        'Click a section heading to collapse or expand that component. An implementation-memory-region heading folds one region, and an expandable row folds or expands the array elements, structure or union members, or pointed-to object beneath it.',
        'Open View to control what occupies the canvas workspace. Under Sections, show or hide Statement, Call stack, Expression expansion, Variables, Memory, and Object writes over time; under Implementation memory regions, show or hide each modeled region independently.',
        'Use the canvas magnifiers to zoom its drawing, and scroll the canvas when the visualization is larger than its window.',
      ],
    },
    {
      title: 'Work with files',
      items: [
        'Loading more than one source file adds tabs. The filled triangle marks the entry source file; choose a hollow triangle to select another. Save downloads the active tab as a C source file.',
        'Open can also restore a valid c-visualizer session supplied by an embedding page, including its source, cursor, breakpoints, and pinned values.',
        'File Upload is for data files that the running C program accesses with functions such as fopen. Uploaded data files can be downloaded or removed and are separate from source files.',
      ],
    },
    {
      title: 'Adjust the workspace',
      items: [
        'The text-size buttons change the editor font, and the theme menu switches between light and dark. Canvas zoom is controlled separately in the canvas toolbar.',
        'Drag the handles between the editor, console, columns, and canvas to resize them, or double-click a handle to restore its default size.',
      ],
    },
    {
      title: 'Keyboard and mouse shortcuts',
      items: [
        'Ctrl stands for Command on macOS. During a session the editor is read-only, so the editing shortcuts apply before a run starts and after it stops.',
        'Editing follows the usual conventions: Ctrl+Z undoes, Ctrl+Y redoes (Command+Shift+Z on macOS), Ctrl+A selects the whole program, Ctrl+/ comments or uncomments the selected lines, and Tab and Shift+Tab indent and unindent.',
        'Ctrl+I grows the selection to the enclosing expression, statement, compound statement, and function definition, showing the source structure. Alt+Up and Alt+Down move the current line, adding Shift copies it, and Ctrl+Shift+K deletes it.',
        'Ctrl+Space opens the completion list; Up and Down choose a completion, Enter accepts it, and Escape dismisses the list.',
        'Ctrl+Shift+[ folds the block at the cursor and Ctrl+Shift+] unfolds it; on macOS these are Command+Alt+[ and Command+Alt+]. Ctrl+Alt+[ and Ctrl+Alt+] fold and unfold the whole file.',
        'F12 goes to the declaration of the name at the cursor. Ctrl-click a name does the same with the pointer, and holding the key underlines the names that can be followed.',
        'Double-click a cell in the memory view to go to the object declaration or function definition it represents.',
        'Alt-click a name pins its tooltip as a live watch, and Alt-click it again removes the watch. Clicking the breakpoint gutter sets or removes a breakpoint.',
        'In the console input field, Enter submits the line and Shift+Enter adds another line before submitting.',
        'Debugger shortcuts follow the toolbar: F5 runs or continues, F6 steps into the next statement or function call, F7 steps over function calls, and F9 toggles a breakpoint on the line containing the cursor.',
        'Resize handles take keyboard focus: with a handle focused, the arrow keys resize the panes it separates and Enter restores the default size.',
        'Escape closes this dialog.',
      ],
    },
  ],
  fileUpload: 'File Upload',
  uploadFile: 'The uploaded file will be displayed here.',
  downloadFile: 'download',
  removeFile: 'remove',
  consoleTitle: 'Standard streams',
  consoleInputLabel: 'standard input stream',
  // The console only accepts input while a read is blocked, so the hint is
  // also how the user learns that the program is waiting for one.
  consoleInputHint: 'Enter to submit, Shift+Enter for another line',
  atAddress: 'address',
  // Read out at every step, for a reader who is not watching the marker.
  announceStep: 'line',
  editorPlaceholder: 'Write a C program here',
  constructIf: 'if statement',
  constructFor: 'for statement',
  constructWhile: 'while statement',
  constructDoWhile: 'do-while statement',
  constructSwitch: 'switch statement',
  constructReturn: 'return statement',
  constructBreak: 'break statement',
  constructContinue: 'continue statement',
  constructCompound: 'compound statement',
  constructAssignment: 'assignment expression',
  constructVariableDec: 'object declaration',
  constructTypeDec: 'type declaration',
  constructEnumerator: 'enumeration constant',
  constructRecordField: 'structure or union member',
  noInitializer: 'none',
  declarationType: 'type',
  storageClass: 'storage-class specifiers',
  functionSpecifiers: 'storage-class / function specifiers',
  qualifiers: 'type qualifiers',
  initializer: 'initializer',
  identifier: 'identifier',
  returnType: 'return type',
  parameters: 'parameters',
  parameter: 'parameter',
  signature: 'signature',
  pointsAt: 'points to',
  notInScope: 'this identifier is not visible at the current execution point',
  typedefName: 'typedef name',
  enumeration: 'enumeration',
  record: 'containing structure or union type',
  tag: 'tag',
  value: 'value',
  none: 'none',
  constructFunctionDec: 'function definition',
  constructCall: 'function call',
  constructTernary: 'conditional expression',
  constructCast: 'cast expression',
  // The clauses a construct is made of, named as the standard names them.
  // The key is what the interpreter records; the phrase is what is shown.
  clauseCondition: 'controlling expression',
  clauseInitialization: 'initialization',
  clauseIteration: 'iteration expression',
  clauseExpression: 'expression',
  clauseTarget: 'left operand',
  clauseAssignedValue: 'right operand',
  clauseTargetType: 'converted to',
  clauseWhenTrue: 'second operand (when the first compares unequal to 0)',
  clauseWhenFalse: 'third operand (when the first compares equal to 0)',
  clauseArgument: 'corresponding parameter and argument expression',
  clauseCase: 'label',
  // Where a jump goes. A `continue` restarts its loop; everything else leaves
  // the construct it names.
  jumpLeaves: 'transfers control from',
  jumpRestarts: 'continues with the next iteration of',
  onLine: 'on line',
  // What a construct is, beyond what the source spells. A function
  // declaration and a function definition are different things (6.9.1), and
  // the difference is a brace the reader has to scroll to see.
  functionKind: 'declares',
  functionDefinition: 'a function definition, with a body',
  functionPrototype: 'a function declaration, not a definition',
  noteBodyBeforeTest:
    'the body is executed before the controlling expression is first evaluated',
  // What a construct is doing at this step. A fact with no value is a
  // sentence on its own; one with a value reads as `phrase: value`.
  factConditionValue: 'evaluates to',
  factNonzero: 'the scalar value compares unequal to 0, so C treats it as true',
  factZero: 'the scalar value compares equal to 0, so C treats it as false',
  factBranchThen: 'the branch after `if` is the one running',
  factBranchElse: 'the `else` branch is the one running',
  factIterations: 'iterations begun so far',
  factLabel: 'matching label',
  factNoLabel: 'no label matches, and the switch has no `default`',
  factFallsThrough: 'control fell through from an earlier label',
  factArgument: 'argument value assigned to parameter',
  factReturns: 'return value',
  factResolvedTarget: 'object designated by the left operand',
  factWas: 'previously stored value',
  factNow: 'stored value after assignment',
  factConverted: 'conversion result',
  factLoses: 'the conversion changes the value',
  factTimesEntered: 'active invocations of this function',
  factArmNonzero:
    'the second operand is selected because the first compares unequal to 0',
  factArmZero:
    'the third operand is selected because the first compares equal to 0',
  branchCompiled: 'this conditional-inclusion group is active',
  branchSkipped: 'this conditional-inclusion group is inactive',
  definedOnLine: 'defined on line',
  excludedLine: 'excluded by conditional inclusion',
};

export default strings;

/**
 * The string under a key assembled at runtime - `construct${kind}` or
 * `${signal}${command}` - where the compiler cannot check the key against the
 * table.
 */
export const stringFor = (key: string): string => (strings as any)[key];
