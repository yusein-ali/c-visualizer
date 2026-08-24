/**
 * The one thing the application holds above every widget.
 *
 * It was `ThemeProps` in `src/components/Props.ts`, alongside the programming
 * language and the interface language, both since deleted. Nothing is passed
 * as props any more: the widgets take a `dark` boolean, and this is the name
 * the bus carries.
 */
export type Theme = 'light' | 'dark';

export const isDark = (theme: Theme): boolean => theme === 'dark';
