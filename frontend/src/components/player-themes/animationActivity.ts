export type AnimationActivity = {
  request: () => void;
  dispose: () => void;
};

export function createAnimationActivity(
  element: Element,
  render: (now: number) => void,
  continuous: () => boolean = () => true,
): AnimationActivity {
  let disposed = false;
  let visible = true;
  let frame = 0;

  const canRender = () => !disposed && visible && !document.hidden;

  const schedule = () => {
    if (frame || !canRender()) return;
    frame = requestAnimationFrame(tick);
  };

  const tick = (now: number) => {
    frame = 0;
    if (!canRender()) return;
    render(now);
    if (continuous()) schedule();
  };

  const observer = typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(([entry]) => {
        visible = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
        if (visible) schedule();
        else if (frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      }, { threshold: 0.01 });

  const onVisibilityChange = () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    schedule();
  };

  observer?.observe(element);
  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule();

  return {
    request: schedule,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}
