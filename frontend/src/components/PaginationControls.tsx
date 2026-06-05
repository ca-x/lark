import { useEffect, useRef, useState } from "react";
import type { createT } from "../i18n";

export type PageLike = {
  total: number;
  limit: number;
  page: number;
  offset: number;
};

export function PaginationControls({
  page,
  itemCount,
  loading,
  t,
  onPageChange,
}: {
  page: PageLike | null;
  itemCount: number;
  loading: boolean;
  t: ReturnType<typeof createT>;
  onPageChange: (page: number) => void | Promise<void>;
}) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const scrollLockRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const visibleTimerRef = useRef<number | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [jumpValue, setJumpValue] = useState("");
  const total = page?.total ?? 0;
  const limit = page?.limit ?? itemCount;
  const totalPages = page ? Math.max(1, Math.ceil(total / limit)) : 1;
  const currentPage = page ? Math.min(totalPages, Math.max(1, page.page)) : 1;
  const start = page && total ? page.offset + 1 : 0;
  const end = page ? Math.min(total, page.offset + itemCount) : itemCount;
  const canPrevious = Boolean(page) && currentPage > 1 && !loading;
  const canNext = Boolean(page) && currentPage < totalPages && !loading;

  const scrollRoot = () => controlsRef.current?.closest(".main") as HTMLElement | null;

  useEffect(() => {
    return () => {
      if (visibleTimerRef.current != null) window.clearTimeout(visibleTimerRef.current);
    };
  }, []);

  const revealControls = () => {
    setControlsVisible(true);
    if (visibleTimerRef.current != null) window.clearTimeout(visibleTimerRef.current);
    visibleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 1800);
  };

  const changePage = async (nextPage: number, placement: "top" | "bottom" | "keep") => {
    if (!page || loading) return;
    const boundedPage = Math.min(totalPages, Math.max(1, nextPage));
    if (boundedPage === currentPage) return;
    const root = scrollRoot();
    scrollLockRef.current = true;
    revealControls();
    await Promise.resolve(onPageChange(boundedPage));
    window.requestAnimationFrame(() => {
      if (root && placement === "top") {
        root.scrollTo({ top: 4, behavior: "auto" });
      } else if (root && placement === "bottom") {
        root.scrollTo({
          top: Math.max(0, root.scrollHeight - root.clientHeight - 4),
          behavior: "auto",
        });
      }
      window.setTimeout(() => {
        lastScrollTopRef.current = root?.scrollTop ?? window.scrollY;
        scrollLockRef.current = false;
      }, 320);
    });
  };

  useEffect(() => {
    const root = scrollRoot();
    if (!root || total <= limit || total < 10) return;
    lastScrollTopRef.current = root.scrollTop;
    const isDesktop = () => root.clientWidth > 720;
    const onScroll = () => {
      revealControls();
      if (scrollLockRef.current || loading) return;
      const scrollTop = root.scrollTop;
      const delta = scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;
      if (Math.abs(delta) < 8) return;
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      if (delta > 0 && canNext && maxScrollTop - scrollTop <= 36) {
        void changePage(currentPage + 1, "top");
      } else if (isDesktop() && delta < 0 && canPrevious && scrollTop <= 6) {
        void changePage(currentPage - 1, "bottom");
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!isDesktop() || scrollLockRef.current || loading || Math.abs(event.deltaY) < 20) return;
      const maxScrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      if (maxScrollTop > 6) return;
      if (event.deltaY > 0 && canNext) {
        event.preventDefault();
        void changePage(currentPage + 1, "top");
      } else if (event.deltaY < 0 && canPrevious) {
        event.preventDefault();
        void changePage(currentPage - 1, "bottom");
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      root.removeEventListener("scroll", onScroll);
      root.removeEventListener("wheel", onWheel);
    };
  }, [canNext, canPrevious, currentPage, loading, limit, total]);

  if (!page || total < 10 || total <= limit) return null;

  const jumpToPage = () => {
    const nextPage = Number(jumpValue);
    if (!Number.isInteger(nextPage)) return;
    void changePage(nextPage, "top");
  };

  return (
    <>
      <div
        className={controlsVisible ? "pagination-controls is-visible" : "pagination-controls"}
        ref={controlsRef}
        onMouseEnter={revealControls}
        onFocus={revealControls}
      >
        <span>{start}-{end} / {page.total}</span>
        <div>
          <button disabled={!canPrevious} onClick={() => void changePage(currentPage - 1, "bottom")}>
            {t("previousPage")}
          </button>
          <strong>{t("pageStatus").replace("{current}", String(currentPage)).replace("{total}", String(totalPages))}</strong>
          <button disabled={!canNext} onClick={() => void changePage(currentPage + 1, "top")}>
            {loading ? t("loading") : t("nextPage")}
          </button>
          <label>
            <span>{t("goToPage")}</span>
            <input
              inputMode="numeric"
              min={1}
              max={totalPages}
              type="number"
              value={jumpValue}
              onChange={(event) => setJumpValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") jumpToPage();
              }}
            />
          </label>
          <button disabled={loading || !jumpValue} onClick={jumpToPage}>
            {t("jump")}
          </button>
        </div>
      </div>
      <div className="pagination-spacer" aria-hidden="true" />
    </>
  );
}
