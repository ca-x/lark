import { useState, type ReactNode } from "react";
import { CaretDown } from "@phosphor-icons/react";

type SettingsSectionProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
  wideRow?: boolean;
};

export function SettingsSection({
  title,
  description,
  defaultOpen = true,
  children,
  className,
  wideRow,
}: SettingsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const classes = ["settings-section", wideRow ? "settings-wide-row" : ""].filter(Boolean).join(" ");
  return (
    <div className={`${classes}${className ? ` ${className}` : ""}`} data-open={open ? "true" : "false"}>
      <button
        type="button"
        className="settings-section-head"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <span className="settings-section-text">
          <strong>{title}</strong>
          {description ? <span>{description}</span> : null}
        </span>
        <span className="settings-section-caret" aria-hidden="true">
          <CaretDown weight="bold" />
        </span>
      </button>
      {open ? <div className="settings-section-body">{children}</div> : null}
    </div>
  );
}
