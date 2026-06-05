import { memo, useEffect, useRef, useState } from "react";

export const LazyCoverImage = memo(function LazyCoverImage({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState("");
  const [canLoad, setCanLoad] = useState(false);
  const [deferredSrc, setDeferredSrc] = useState("");
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (src !== failedSrc) setFailedSrc("");
    imageRef.current?.removeAttribute("data-loaded");
  }, [failedSrc, src]);

  useEffect(() => {
    setCanLoad(false);
    setDeferredSrc("");
    if (!src || failedSrc === src) return;
    const node = imageRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      setCanLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setCanLoad(true);
        observer.disconnect();
      },
      { rootMargin: "220px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [failedSrc, src]);

  useEffect(() => {
    setDeferredSrc("");
    if (!canLoad || !src || failedSrc === src) return;
    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const load = () => setDeferredSrc(src);
    if (win.requestIdleCallback) {
      idleHandle = win.requestIdleCallback(load, { timeout: 700 });
    } else {
      timeoutHandle = window.setTimeout(load, 90);
    }
    return () => {
      if (idleHandle != null) win.cancelIdleCallback?.(idleHandle);
      if (timeoutHandle != null) window.clearTimeout(timeoutHandle);
    };
  }, [canLoad, failedSrc, src]);

  if (!src || failedSrc === src) return null;
  return (
    <img
      ref={imageRef}
      className="cover-image"
      src={deferredSrc || undefined}
      data-deferred={deferredSrc ? undefined : "true"}
      alt=""
      loading="lazy"
      decoding="async"
      fetchPriority="low"
      onLoad={(event) => {
        event.currentTarget.dataset.loaded = "true";
      }}
      onError={() => setFailedSrc(src)}
    />
  );
});
