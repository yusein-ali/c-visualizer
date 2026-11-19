import { exec, outputOf } from './library';

/**
 * The names the preprocessor and the language predefine - `__LINE__`,
 * `__FILE__`, `__func__` - the `#` operator, and the adjacent string
 * literals stringizing leaves behind it.
 */

describe('__LINE__, __FILE__ and __func__', () => {
  it('give the line, a file name and the function', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) { printf("%s %d %s\\n", __FILE__ == 0 ? "" : "f", __LINE__, __func__); return 0; }`)
    ).toBe('f 2 main\n');
  });

  it('name the file and the function each is read in', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <string.h>
void report(void)
{
	printf("%s:%d %s\\n", __FILE__, __LINE__, __func__);
}
int main(void)
{
	report();
	printf("%s %d\\n", __func__, (int)strlen(__func__));
	return 0;
}`)
    ).toBe('main.c:5 report\nmain 4\n');
  });

  it('names a recursive function without its frame number', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int depth(int n)
{
	if (n == 0) {
		printf("%s\\n", __func__);
		return 0;
	}
	return depth(n - 1);
}
int main(void) { return depth(2); }`)
    ).toBe('depth\n');
  });

  it('is not reported as an undeclared name', async () => {
    const run = await exec(`#include <stdio.h>
int main(void) { puts(__func__); return 0; }`);
    expect(run.output).toBe('main\n');
    expect(run.response.errors).toEqual([]);
  });
});

describe('the # operator and adjacent string literals', () => {
  it('stringizes a macro argument', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#define SHOW(x) printf(#x " = %d\\n", x)
int main(void) { int pages = 3; SHOW(pages); SHOW(pages + 1); return 0; }`)
    ).toBe('pages = 3\npages + 1 = 4\n');
  });

  it('joins adjacent literals in a call, a declaration and an array', async () => {
    expect(
      await outputOf(`#include <stdio.h>
#include <string.h>
int main(void)
{
	const char *s = "ab" "cd";
	char t[] = "x" "y"
	           "z";
	printf("%s %s %d %d\\n", s, t, (int)strlen(s), (int)sizeof t);
	printf("one " "two\\n");
	return 0;
}`)
    ).toBe('abcd xyz 4 4\none two\n');
  });

  it('keeps a hexadecimal escape apart from a digit after it', async () => {
    expect(
      await outputOf(`#include <stdio.h>
int main(void) { const char *s = "\\x41" "1"; printf("%s\\n", s); return 0; }`)
    ).toBe('A1\n');
  });
});
