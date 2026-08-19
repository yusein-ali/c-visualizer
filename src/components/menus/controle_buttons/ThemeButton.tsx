import * as React from 'react';
import CtrlButton from './CtrlButton';
import { Theme } from '../../Props';

interface Props {}

interface State {
  theme: Theme;
}

export default class ThemeButton extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { theme: 'light' };
  }
  renderLightTheme() {
    return (
      <CtrlButton
        signal="changeTheme"
        command="dark"
        icon="star-empty"
        enable={true}
        onClick={() => this.setState({ theme: 'dark' })}
      />
    );
  }
  renderDarkTheme() {
    return (
      <CtrlButton
        signal="changeTheme"
        command="light"
        icon="star"
        enable={true}
        onClick={() => this.setState({ theme: 'light' })}
      />
    );
  }
  render() {
    if (this.state.theme === 'light') {
      return this.renderLightTheme();
    } else {
      return this.renderDarkTheme();
    }
  }
}
