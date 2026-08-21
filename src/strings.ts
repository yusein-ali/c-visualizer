/**
 * Every piece of text the interface shows, in one table. c-visualizer is
 * English-only: there is no locale to select and no translation layer to go
 * through, so a widget reads the string it needs straight off this object.
 */
const strings = {
  howToUse: 'How to use',
  close: 'Close',
  tabsLabel: 'Open files',
  tabRuns: 'this is the file that runs',
  tabMakeEntry: 'run this file instead',
  tabClose: 'Close',
  openCode: 'Open',
  openCodeHint: 'Open a C file, or a session saved from here',
  saveCode: 'Save',
  saveCodeHint: 'Write the program out as a C file',
  openedNotCode: 'That file could not be read as a program.',
  savedFileName: 'program.c',
  preprocessedButton: 'Preprocessed',
  preprocessedTitle: 'The source the compiler sees',
  preprocessedHint:
    'What you wrote, beside what #define and #if left of it. Nothing here is editable.',
  debugStatus: 'DebugStatus',
  step: 'Step',
  theme: 'theme',
  themeLight: 'Light theme',
  themeDark: 'Dark theme',
  debugStart: 'restart step execution',
  debugStop: 'stop execution',
  debugBackAll: 'go backward for all steps',
  debugStepBack: 'step backward',
  debugStep: 'step forward',
  debugStepAll: 'execute all step',
  // Before a session exists the double arrow starts one and runs it; the
  // button had no title at all in that state.
  debugExec: 'run to the first breakpoint',
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
  graphViewRegions: 'Memory regions',
  graphViewSections: 'Sections',
  // The state views consolidated into the canvas workspace.
  viewCallStack: 'Call stack',
  viewMutations: 'Variables over time',
  viewNothingRunning: 'nothing is running',
  viewNothingWritten: 'nothing has been written yet',
  viewCalledFrom: 'called from line',
  viewColumnFrame: 'In',
  viewColumnObject: 'Object',
  viewColumnBefore: 'Before',
  viewColumnAfter: 'After',
  viewColumnLine: 'Line',
  graphViewStatement: 'Statement',
  memoryRegisters: 'Registers',
  memoryText: 'Text',
  memoryReadOnly: 'Read-only memory',
  memoryData: 'Initialized data',
  memoryBss: 'Zero-initialized data (BSS)',
  memoryHeap: 'Heap',
  memoryStack: 'Stack',
  memoryColumnAddress: 'Address',
  memoryColumnName: 'Name',
  memoryColumnValue: 'Value',
  memoryEmptySegment: 'empty at this step',
  // The JointJS sections, read as cause then state: the operation and active
  // call, its expression, and what the program holds after it.
  graphMemoryHeading: 'Memory',
  graphStatementHeading: 'Statement',
  graphExpressionHeading: 'Expression expansion',
  expressionNotAvailable: 'no expression is available at this step',
  statementNotRunning: 'no statement is running',
  statementCurrent: 'Current statement',
  statementNoActive: 'No active statement',
  statementOnLine: 'Currently executing on line',
  statementLoopExitedOnLine:
    'Loop exited after evaluating its controlling expression on line',
  statementStartHint:
    'Start or step through the program to see what the current statement does.',
  statementWith: 'with',
  statementAnd: 'and',
  statementWhich: 'which',
  statementControllingExpression: 'Its controlling expression',
  statementReadsNonzero:
    'C reads the evaluated expression as true because it is not zero',
  statementReadsZero:
    'C reads the evaluated expression as false because it is zero',
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
        'Write C in the editor or choose Open to add a C file. The editor checks the entry file after you pause typing and marks syntax errors, runtime problems, and teaching suggestions; some suggestions include a one-click fix.',
        'Completions offer C constructs, names in the program, and common library functions.',
        'Use the fold gutter to collapse blocks. Macro expansions, directives, and code excluded by conditional compilation are marked in the editor; choose Preprocessed to compare your source with the source produced by preprocessing.',
        'In an exercise, only the regions chosen by its author may be editable. c-visualizer keeps the rest of the program fixed.',
      ],
    },
    {
      title: 'Use editor tooltips',
      items: [
        'Pause the pointer over a name or marked part of the source to open its tooltip. A tooltip describes the smallest relevant item under the pointer, so hovering an operator or subexpression can give a more specific answer than hovering the surrounding statement.',
        'Before a run, tooltips explain declarations and C constructs. They can show types, qualifiers, storage classes, parameters, control-flow clauses, conversions, and where break, continue, or return transfers control. Common library functions show their signature and purpose.',
        'While stopped on a debug step, a variable tooltip shows its current type, value, and address; a pointer also shows the object and value it points to. Tooltips on the current expression show values already produced, and control-flow tooltips explain conditions, selected branches, loop iterations, arguments, and return values for that step.',
        'Preprocessor tooltips show macro-expansion chains and definition lines, whether a conditional branch was compiled or skipped, and which source was excluded. Hover over an error or teaching marker to read the diagnostic and any available library help or suggested fix.',
        'Hovering a live variable also highlights the matching declaration and memory row on the canvas. Alt-click a name to pin its tooltip as a live watch; Alt-click it again to remove the watch. A pinned watch updates at every step and says when the name is outside the currently executing scope.',
      ],
    },
    {
      title: 'Run and step through it',
      items: [
        'Click the breakpoint gutter to set or remove a breakpoint. Continue stops at the next breakpoint, standard-input request, or the end of the program.',
        'The six execution buttons, from left to right, restart, stop, rewind to the first recorded step, step backward, step forward, and continue. Before a session starts, the two forward buttons start stepping or run to the first breakpoint.',
        'During a session the source is read-only. The editor highlights the current statement, shows relevant values beside it, shades lines by how often they ran, and the status displays the current step. Stop to edit the source again.',
        'Backward controls replay recorded history; they do not execute C in reverse. Restart begins again with the current source and breakpoints.',
      ],
    },
    {
      title: 'Read input and output',
      items: [
        'Program output from functions such as printf appears below the editor. When a function such as scanf waits for input, the input field becomes available and receives focus.',
        'Press Enter to submit the input, or Shift+Enter to add another line before submitting. Execution continues until it next pauses for input, reaches a breakpoint, or finishes.',
      ],
    },
    {
      title: 'Explore the visualization',
      items: [
        'The canvas is arranged from cause to state: Statement and Call stack appear first, Expression expansion follows them, Memory shows the resulting program state, and Variables over time records the writes that produced it.',
        'Statement names the current C construct and source line, then explains what the statement is doing. Depending on the step, it shows clauses, condition results, the selected branch, assignments, arguments, return values, conversions, and values produced so far.',
        'Call stack lists every active function call with the current call first. Each entry can show the line it was called from, the argument value assigned to each parameter, and how many times a recursive function has been entered.',
        'Expression expansion draws the active expression as a tree of operands and operators. Values appear on names and on subexpressions as they become available, making the evaluation order and intermediate results visible.',
        'Memory is a map of the program’s address space. Every object row shows its address, name, value, type, and size when available. Pointer arrows start at pointer values and end at the addressed object; arrays, structures, unions, and pointed-to objects can be expanded into their parts.',
        'Registers contains variables declared with the register storage class. Stack contains parameters and automatic local variables grouped by active function frame, while Heap contains storage obtained dynamically with functions such as malloc.',
        'Initialized data contains initialized writable global and static objects, and Zero-initialized data (BSS) contains global and static objects that begin as zero. Read-only memory contains constants and string literals, while Text contains the program’s functions and their addresses.',
        'Variables over time lists writes newest first. Its columns identify the function frame and object, the value before and after the write, and the source line responsible, which helps trace where an unexpected value came from.',
        'Hover over a variable in either the editor or canvas to highlight the matching declaration and memory row. Pointer arrows and matching highlights connect the source-level name to the object represented in memory.',
        'Click a section heading to collapse or expand that whole component. A memory-region heading folds one address-space region, and an aggregate row folds or expands the array, structure, union, or pointed-to object beneath it.',
        'Open View to control what occupies the canvas workspace. Under Sections, show or hide Statement, Call stack, Expression expansion, Memory, and Variables over time; under Memory regions, show or hide Registers, Stack, Heap, Zero-initialized data, Initialized data, Read-only memory, and Text independently.',
        'Use the canvas magnifiers to zoom its drawing, and scroll the canvas when the visualization is larger than its window.',
      ],
    },
    {
      title: 'Work with files',
      items: [
        'Opening more than one source file adds tabs. The filled triangle marks the entry file that runs; choose a hollow triangle to make another tab the entry file. Save downloads the active tab as a C file.',
        'Open can also restore a valid c-visualizer session supplied by an embedding page, including its source, cursor, breakpoints, and pinned values.',
        'File Upload is for data that the running C program opens with functions such as fopen. Uploaded files can be downloaded or removed and are separate from source tabs.',
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
        'Ctrl+I grows the selection to the enclosing expression, then the statement, the block, and the function, which shows how the program nests. Alt+Up and Alt+Down move the current line, adding Shift copies it, and Ctrl+Shift+K deletes it.',
        'Ctrl+Space opens the completion list; Up and Down choose a completion, Enter accepts it, and Escape dismisses the list.',
        'Ctrl+Shift+[ folds the block at the cursor and Ctrl+Shift+] unfolds it; on macOS these are Command+Alt+[ and Command+Alt+]. Ctrl+Alt+[ and Ctrl+Alt+] fold and unfold the whole file.',
        'F12 goes to the declaration of the name at the cursor. Ctrl-click a name does the same with the pointer, and holding the key underlines the names that can be followed.',
        'Alt-click a name pins its tooltip as a live watch, and Alt-click it again removes the watch. Clicking the breakpoint gutter sets or removes a breakpoint.',
        'In the console input field, Enter submits the line and Shift+Enter adds another line before submitting.',
        'Resize handles take keyboard focus: with a handle focused, the arrow keys resize the panes it separates and Enter restores the default size.',
        'Escape closes this dialog.',
      ],
    },
  ],
  fileUpload: 'File Upload',
  uploadFile: 'The uploaded file will be displayed here.',
  downloadFile: 'download',
  removeFile: 'remove',
  consoleTitle: 'STDIO Console',
  consoleInputLabel: 'standard input',
  // The console only accepts input while a read is blocked, so the hint is
  // also how the user learns that the program is waiting for one.
  consoleInputHint: 'Enter to submit, Shift+Enter for another line',
  atAddress: 'address',
  // Read out at every step, for a reader who is not watching the marker.
  announceStep: 'line',
  editorPlaceholder: 'Write a C program here',
  constructIf: 'if statement',
  constructFor: 'for loop',
  constructWhile: 'while loop',
  constructDoWhile: 'do-while loop',
  constructSwitch: 'switch statement',
  constructReturn: 'return statement',
  constructBreak: 'break',
  constructContinue: 'continue',
  constructAssignment: 'assignment statement',
  constructVariableDec: 'variable declaration',
  constructTypeDec: 'type declaration',
  constructEnumerator: 'enumeration constant',
  constructRecordField: 'structure or union member',
  uninitialized: 'uninitialized',
  declarationType: 'type',
  storageClass: 'storage class',
  qualifiers: 'qualifiers',
  identifier: 'identifier',
  returnType: 'return type',
  parameters: 'parameters',
  parameter: 'parameter',
  signature: 'signature',
  pointsAt: 'points at',
  notInScope: 'no name of this kind is in the frame being executed',
  typedefName: 'typedef name',
  enumeration: 'enumeration',
  record: 'structure or union',
  tag: 'tag',
  value: 'value',
  none: 'none',
  constructFunctionDec: 'function definition',
  constructCall: 'function call',
  constructTernary: 'conditional expression',
  constructCast: 'type cast',
  // The clauses a construct is made of, named as the standard names them.
  // The key is what the interpreter records; the phrase is what is shown.
  clauseCondition: 'controlling expression',
  clauseInitialization: 'initialization',
  clauseIteration: 'iteration expression',
  clauseExpression: 'expression',
  clauseTarget: 'assigned object',
  clauseAssignedValue: 'assigned value',
  clauseTargetType: 'converted to',
  clauseWhenTrue: 'when nonzero',
  clauseWhenFalse: 'when zero',
  clauseArgument: 'argument',
  // Where a jump goes. A `continue` restarts its loop; everything else leaves
  // the construct it names.
  jumpLeaves: 'leaves',
  jumpRestarts: 'restarts',
  onLine: 'on line',
  // What a construct is, beyond what the source spells. A function
  // declaration and a function definition are different things (6.9.1), and
  // the difference is a brace the reader has to scroll to see.
  functionKind: 'declares',
  functionDefinition: 'a definition, with a body',
  functionPrototype: 'a declaration, with no body',
  noteBodyBeforeTest: 'the body runs once before the first test',
  // What a construct is doing at this step. A fact with no value is a
  // sentence on its own; one with a value reads as `phrase: value`.
  factConditionValue: 'evaluates to',
  factNonzero: 'which C reads as true, because it is not zero',
  factZero: 'which C reads as false, because it is zero',
  factBranchThen: 'the branch after `if` is the one running',
  factBranchElse: 'the `else` branch is the one running',
  factIterations: 'iterations begun so far',
  factLabel: 'label selected',
  factFallsThrough: 'control fell through from an earlier label',
  factArgument: 'argument',
  factReturns: 'returns',
  factResolvedTarget: 'assigned object at this step',
  factWas: 'previous value',
  factNow: 'value stored',
  factConverted: 'converted',
  factLoses: 'the conversion did not keep the value',
  factTimesEntered: 'times entered',
  factArmNonzero: 'the arm taken when the condition is nonzero',
  factArmZero: 'the arm taken when the condition is zero',
  branchCompiled: 'this branch is compiled',
  branchSkipped: 'this branch is skipped',
  definedOnLine: 'defined on line',
  excludedLine: 'excluded from compilation',
  sourceCode: String.raw`#include<stdio.h>
int recursiveToThree(int n){
  printf("%d th\n", n + 1);
  if(n < 3){
      int r = recursiveToThree(n + 1);
      n = r;
  }
  return n;
}
int main(){
  int n = 0;//variable declaration

  n = recursiveToThree(0);//recursive function

  int arr[5] = {1, 2, 3};//array variable

  int* ptr = &arr[2];//pointer variable
  *ptr = 5;

  //dynamic memory allocation
  int* d_arry = malloc(sizeof(int) * 3);

  //two-dimensional dynamic array
  int* pd_arr[2];
  pd_arr[0] = malloc(sizeof(int) * 2);
  pd_arr[1] = malloc(sizeof(int) * 2);

  printf("Hello,world!\n");//standard output

  free(pd_arr[0]);//memory leak

  //File Output
  {
    FILE* fp=NULL;
    fp = fopen("c-visualizer.txt", "w");
    fputs("c-visualizer", fp);
    fclose(fp);
  }

  //File Input
  {
    FILE* fp=NULL;
    char buf[13];
    fp = fopen("c-visualizer.txt", "r");
    while(fgets(buf,13,fp) != NULL) {
      printf("%s",buf);
    }
    fclose(fp);
  }
  return 0;
}`,
};

export default strings;

/**
 * The string under a key assembled at runtime - `construct${kind}` or
 * `${signal}${command}` - where the compiler cannot check the key against the
 * table.
 */
export const stringFor = (key: string): string => (strings as any)[key];
