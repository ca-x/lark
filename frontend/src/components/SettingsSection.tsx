import { useId, useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";

type SettingsSectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  wideRow?: boolean;
  owner?: string;
};

export function SettingsSection({
  title,
  description,
  defaultOpen = true,
  children,
  className,
  wideRow,
  owner,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const headingId = useId();
  const contentId = useId();
  const classes = ["settings-section", wideRow ? "settings-wide-row" : ""].filter(Boolean).join(" ");
  return (
    <div
      className={`${classes}${className ? ` ${className}` : ""}`}
      data-open={open ? "true" : "false"}
      data-settings-owner={owner}
    >
      <button
        type="button"
        className="settings-section-head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span className="settings-section-text">
          <strong id={headingId}>{title}</strong>
          {description ? <span>{description}</span> : null}
        </span>
        <span className="settings-section-caret" aria-hidden="true">
          <CaretDown weight="bold" />
        </span>
      </button>
      {open ? (
        <div id={contentId} className="settings-section-body" role="region" aria-labelledby={headingId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
