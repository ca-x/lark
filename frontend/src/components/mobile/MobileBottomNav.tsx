import { cloneElement, isValidElement, type CSSProperties, type ReactNode } from "react";

export type MobileBottomNavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function MobileBottomNav({
  items,
  label,
}: {
  items: MobileBottomNavItem[];
  label: string;
}) {
  const style = { "--mobile-bottom-nav-count": items.length } as CSSProperties;

  return (
    <nav className="mobile-bottom-nav" aria-label={label} style={style}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.active ? "active" : ""}
          aria-current={item.active ? "page" : undefined}
          aria-label={item.label}
          disabled={item.disabled}
          title={item.label}
          onClick={item.onSelect}
        >
          <span className="mobile-bottom-nav-icon" aria-hidden="true">
            {item.active && isValidElement<{ weight?: string }>(item.icon)
              ? cloneElement(item.icon, { weight: "fill" })
              : item.icon}
          </span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
