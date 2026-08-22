import { emptyStepModel } from '../src/core';
import { variableContextLabel, variableTableRows } from '../src/ui/graph';

describe('the current-context variable table', () => {
  it('shows file-scope objects and the executing frame, not caller locals', () => {
    const model = emptyStepModel();
    model.context = { file: 'helper.c', function: 'helper' };
    model.variables = [
      {
        name: 'shared',
        key: 'GLOBAL-shared',
        type: 'int',
        value: '4',
        address: 0x3000,
        region: 'data',
        frame: 'GLOBAL',
        active: false,
      },
      {
        name: 'result',
        key: 'main-result',
        type: 'int',
        value: '3',
        address: 0xfff0,
        region: 'stack',
        frame: 'main',
        active: false,
      },
      {
        name: 'Heap:0',
        key: 'GLOBAL-Heap:0',
        type: 'int',
        value: '9',
        address: 0x4e20,
        region: 'heap',
        frame: 'GLOBAL',
        active: false,
      },
      {
        name: 'value',
        key: 'helper-value',
        type: 'int',
        value: '6',
        address: 0xffe0,
        region: 'stack',
        frame: 'helper',
        active: true,
      },
    ];

    expect(variableContextLabel(model)).toBe(
      'File: helper.c  ·  Function: helper()'
    );
    expect(variableTableRows(model)).toEqual([
      {
        key: 'GLOBAL-shared',
        name: 'shared',
        value: '4',
        segment: 'Initialized static storage (data)',
        address: '0x3000',
      },
      {
        key: 'helper-value',
        name: 'value',
        value: '6',
        segment: 'Automatic storage (stack)',
        address: '0xFFE0',
      },
    ]);
  });

  it('states when no source or function context is active', () => {
    expect(variableContextLabel(emptyStepModel())).toBe(
      'File: none  ·  Function: none'
    );
    expect(variableTableRows(emptyStepModel())).toEqual([]);
  });
});
