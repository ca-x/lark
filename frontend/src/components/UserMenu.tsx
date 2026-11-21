import { useEffect, useId, useRef, useState } from "react";
import { CaretDown, SignOut, Terminal, UserCircle } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import type { User } from "../types";

export function UserAvatar({ user }: { user: User }) {
  const label = (user.nickname || user.username || "U").trim();
  const initial = label.slice(0, 1).toUpperCase();
  return user.avatar_data_url ? (
    <img className="user-avatar" src={user.avatar_data_url} alt={label} />
  ) : (
    <span className="user-avatar user-avatar-fallback" aria-label={label}>
      <span>{initial}</span>
    </span>
  );
}

export function UserMenu({
  user,
  t,
  profileEnabled = true,
  onOpenProfile,
  onOpenShellMode,
  onLogout,
}: {
  user: User;
  t: ReturnType<typeof createT>;
  profileEnabled?: boolean;
  onOpenProfile: () => void;
  onOpenShellMode?: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const startAtEnd = useRef(false);
  const menuId = useId();
  const label = user.nickname || user.username;

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    items?.[startAtEnd.current ? items.length - 1 : 0]?.focus({ preventScroll: true });
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div className="user-menu" ref={menuRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (!open || event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
          return;
        }
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (index + 1) % items.length
          : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : -1;
        if (next >= 0) { event.preventDefault(); items[next].focus(); }
      }}>
      <button
        type="button"
        className={open ? "user-menu-trigger active" : "user-menu-trigger"}
        ref={trigger}
        aria-controls={open ? menuId : undefined}
        aria-haspopup="menu"
        onKeyDown={(event) => {
          if (open || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          startAtEnd.current = event.key === "ArrowUp";
          setOpen(true);
        }}
        aria-expanded={open}
        onClick={() => { startAtEnd.current = false; setOpen((value) => !value); }}
      >
        <UserAvatar user={user} />
        <span>{label}</span>
        <CaretDown weight="bold" />
      </button>
      {open ? (
        <div id={menuId} className="user-menu-popover" role="menu" aria-label={label}>
          <div className="user-menu-head">
            <UserAvatar user={user} />
            <div>
              <strong>{label}</strong>
              <span>@{user.username}</span>
            </div>
          </div>
          {profileEnabled ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenProfile();
              }}
            >
              <UserCircle /> {t("profileSettings")}
            </button>
          ) : null}
          {onOpenShellMode ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onOpenShellMode();
              }}
            >
              <Terminal /> {t("shellMode")}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            <SignOut /> {t("logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
