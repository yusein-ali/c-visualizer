export type Theme = 'light' | 'dark';

export interface ThemeProps extends React.Props<{}> {
  theme: Theme;
}
