import { PlivetCPP14Interpreter } from '../src/interpreter/CPP14';
import { exec } from './library';

/**
 * A member's type must be complete where the member is declared (C11
 * 6.7.2.1p3): a structure is complete only after its definition's closing
 * brace. gcc refuses `struct author author;` in a structure defined before
 * `struct author` is; the interpreter ran it.
 */

const errorsOf = (code: string) =>
  new PlivetCPP14Interpreter().checkSyntaxError(code);

const AUTHOR_LATER = `#include <stdio.h>

struct author;

struct book {
	char *title;
	struct author author;
};

struct author {
	char *name;
};

int main(void)
{
	struct book b;
	b.title = "The Hobbit";
	b.author.name = "Tolkien";
	printf("%s by %s\\n", b.title, b.author.name);
	return 0;
}`;

describe('a member of an incomplete structure type', () => {
  it('is refused where it is declared', async () => {
    const errors = errorsOf(AUTHOR_LATER);
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(7);
    expect(errors[0].msg).toMatch(/author has incomplete type struct author/);
    const run = await exec(AUTHOR_LATER);
    expect(run.output).toBe('');
  });

  it('is refused for a structure never defined, and for itself', () => {
    expect(
      errorsOf('struct a { struct missing m; };\nint main(void) { return 0; }')
    ).toHaveLength(1);
    expect(
      errorsOf(
        'struct node { int v; struct node next; };\nint main(void) { return 0; }'
      )
    ).toHaveLength(1);
  });

  it('accepts a pointer to it, and a member defined first or inline', () => {
    expect(
      errorsOf(`struct author;
struct book { struct author *author; struct inner { int x; } in; };
struct author { char *name; };
struct shelf { struct book books[2]; struct author a; };
typedef struct author Author;
struct loan { Author who; };
int main(void) { return 0; }`)
    ).toEqual([]);
  });
});
