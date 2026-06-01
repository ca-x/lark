import type { ReactNode } from "react";

type EmptyStateVariant = "default" | "compact" | "rich";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  variant?: EmptyStateVariant;
};

export function EmptyState({
  icon,
  title,
  description,
  actions,
  variant = "default",
}: EmptyStateProps) {
  return (
    <div className={`empty-state empty-state-${variant}`} role="status">
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <strong className="empty-state-title">{title}</strong>
      {description ? <p className="empty-state-desc">{description}</p> : null}
      {actions ? <div className="empty-state-actions">{actions}</div> : null}
    </div>
  );
}
