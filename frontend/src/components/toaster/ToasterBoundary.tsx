import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  title: string;
  message: string;
  backLabel: string;
  onBack: () => void;
};

export default class ToasterBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="empty-state" role="alert">
        <h2>{this.props.title}</h2>
        <p>{this.props.message}</p>
        <button type="button" className="secondary" onClick={this.props.onBack}>{this.props.backLabel}</button>
      </section>
    );
  }
}
