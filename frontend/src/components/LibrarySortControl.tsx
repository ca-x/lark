import { Check, SortAscending } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { SongSort } from "../types";

type Labels = {
  sort: string;
  addedDesc: string;
  addedAsc: string;
  filenameAsc: string;
  filenameDesc: string;
};

export function LibrarySortControl({ value, mobile, labels, onChange }: {
  value: SongSort;
  mobile: boolean;
  labels: Labels;
  onChange: (value: SongSort) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const options: Array<{ value: SongSort; label: string }> = [
    { value: "added_desc", label: labels.addedDesc },
    { value: "added_asc", label: labels.addedAsc },
    { value: "filename_asc", label: labels.filenameAsc },
    { value: "filename_desc", label: labels.filenameDesc },
  ];
  const current = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const choose = (next: SongSort) => {
    onChange(next);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="library-sort-control">
      <button ref={triggerRef} type="button" className="library-sort-trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <SortAscending /> <span>{current.label}</span>
      </button>
      {open ? (
        <>
          {mobile ? <button type="button" className="library-sort-backdrop" aria-label={labels.sort} onClick={() => setOpen(false)} /> : null}
          <div className={mobile ? "library-sort-menu library-sort-sheet" : "library-sort-menu"} role="menu" aria-label={labels.sort}>
            <strong>{labels.sort}</strong>
            {options.map((option) => (
              <button key={option.value} type="button" role="menuitemradio" aria-checked={option.value === value} onClick={() => choose(option.value)}>
                <span>{option.label}</span>{option.value === value ? <Check weight="bold" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
