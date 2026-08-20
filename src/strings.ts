/**
 * Every piece of text the interface shows, in one table. PLIVET is
 * English-only: there is no locale to select and no translation layer to go
 * through, so a widget reads the string it needs straight off this object.
 */
const strings = {
  howToUse: 'How to use',
  close: 'Close',
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
  expressionEvaluation: 'Expression evaluation',
  howToText: [
    'PVC.js has five GUI components:',
    '(1) editor, (2) execution controller, buttons, (3) I/O window, (4) canvas for visualization, and (5) file upload form.',
    'Users can write source code in the editor. Clicking on the execution control buttons initiates the step execution.',
    'The I/O window shows the content of the standard output written by the program (e.g., printf) and accepts standard input (e.g., scanf).',
    "Canvas shows the program's execution status using tables and figures.",
    'PVC.js adaptively changes its layout to correspond with the size of the browser window.',
  ],
  fileUpload: 'File Upload',
  uploadFile: 'The uploaded file will be displayed here.',
  downloadFile: 'download',
  removeFile: 'remove',
  consoleInputLabel: 'standard input',
  // The console only accepts input while a read is blocked, so the hint is
  // also how the user learns that the program is waiting for one.
  consoleInputHint: 'Enter to submit, Shift+Enter for another line',
  atAddress: 'address',
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
    fp = fopen("PLIVET.txt", "w");
    fputs("PLIVET", fp);
    fclose(fp);
  }

  //File Input
  {
    FILE* fp=NULL;
    char buf[7];
    fp = fopen("PLIVET.txt", "r");
    while(fgets(buf,10,fp) != NULL) {
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
