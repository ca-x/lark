import type { ReactNode } from "react";

export type MobileBottomNavItem = {
  key: string;
  label: string;
  icon: ReactNode;
  active?: boolean;
  onSelect: () => void;
};

export function MobileBottomNav({
  items,
  label,
}: {
  items: MobileBottomNavItem[];
  label: string;
}) {
  return (
    <nav className="mobile-bottom-nav" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className={item.active ? "active" : ""}
          aria-current={item.active ? "page" : undefined}
          aria-label={item.label}
          title={item.label}
          onClick={item.onSelect}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
