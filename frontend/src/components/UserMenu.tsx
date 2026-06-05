import { useEffect, useRef, useState } from "react";
import { CaretDown, SignOut, UserCircle } from "@phosphor-icons/react";
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
  onLogout,
}: {
  user: User;
  t: ReturnType<typeof createT>;
  profileEnabled?: boolean;
  onOpenProfile: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const label = user.nickname || user.username;

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  return (
    <div className="user-menu" ref={menuRef}>
      <button
        type="button"
        className={open ? "user-menu-trigger active" : "user-menu-trigger"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <UserAvatar user={user} />
        <span>{label}</span>
        <CaretDown weight="bold" />
      </button>
      {open ? (
        <div className="user-menu-popover" role="menu">
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
