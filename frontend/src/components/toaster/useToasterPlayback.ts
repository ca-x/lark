import { useEffect, useRef, useState, type RefObject } from "react";
import type { ToasterSession, ToasterSnapshot, ToasterStudioProps } from "../../features/toaster/contracts";
import { createToasterSession } from "../../features/toaster/session";
import { AUDIO_ANALYSIS_READY } from "../../services/audioAnalysis";

export type ToasterConnection = "waiting" | "ready" | "unavailable" | "error";

const emptySnapshot = (): ToasterSnapshot => ({
  lines: [], bpm: null, key: "", bar: null, step: null, locked: false,
  energy: 0, bass: 0, treble: 0, beat: 0, bands: [], patterns: {}, recordedBars: 0,
});

type Options = Pick<ToasterStudioProps, "audio" | "playing" | "available" | "meta"> & {
  hostRef: RefObject<HTMLElement | null>;
  onFrame: (snapshot: ToasterSnapshot, active: boolean, now: number) => void;
};

export function useToasterPlayback({ audio, playing, available, meta, hostRef, onFrame }: Options) {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [code, setCode] = useState("");
  const [connection, setConnection] = useState<ToasterConnection>("waiting");
  const [visible, setVisible] = useState(() => !document.hidden);
  const [revision, setRevision] = useState(0);
  const sessionRef = useRef<ToasterSession | null>(null);
  const revisionRef = useRef(0);
  const metaRef = useRef(meta);
  const playingRef = useRef(playing);
  const onFrameRef = useRef(onFrame);
  const refreshRef = useRef<() => void>(() => undefined);
  const failedRef = useRef<() => void>(() => undefined);

  useEffect(() => { onFrameRef.current = onFrame; }, [onFrame]);

  useEffect(() => {
    const changed = metaRef.current.mediaKey !== meta.mediaKey;
    metaRef.current = meta;
    if (changed) {
      revisionRef.current++;
      setRevision(revisionRef.current);
      setSnapshot(emptySnapshot());
      setCode("");
    }
    try {
      sessionRef.current?.setMeta(meta);
      refreshRef.current();
    } catch {
      failedRef.current();
    }
  }, [meta.mediaKey, meta.title, meta.artist]);

  useEffect(() => {
    revisionRef.current++;
    setRevision(revisionRef.current);
    let disposed = false;
    let frame = 0;
    let onScreen = true;
    let lastPublish = 0;
    const isVisible = () => onScreen && !document.hidden;
    const activePlayback = () => Boolean(playingRef.current && audio && !audio.paused && !audio.ended && !audio.seeking);
    const cancelFrame = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const fail = () => {
      cancelFrame();
      try { sessionRef.current?.dispose(); } catch { /* The session may already be disconnected. */ }
      sessionRef.current = null;
      revisionRef.current++;
      setRevision(revisionRef.current);
      setConnection("error");
      const resting = emptySnapshot();
      setSnapshot(previous => ({ ...previous, energy: 0, bass: 0, treble: 0, beat: 0, bands: [], step: null }));
      onFrameRef.current(resting, false, performance.now());
    };
    failedRef.current = fail;

    const publish = (next: ToasterSnapshot, now: number, active: boolean, force = false) => {
      onFrameRef.current(next, active, now);
      if (force || now - lastPublish >= 100) {
        lastPublish = now;
        setSnapshot(next);
        const nextCode = sessionRef.current?.code() || "";
        setCode(previous => previous === nextCode ? previous : nextCode);
      }
    };
    const connect = () => {
      if (!audio || !available || !isVisible() || disposed) return null;
      if (sessionRef.current) return sessionRef.current;
      const session = createToasterSession(audio, metaRef.current);
      sessionRef.current = session;
      setConnection(session ? "ready" : "waiting");
      return session;
    };
    const tick = (now: number) => {
      frame = 0;
      if (disposed || !isVisible() || !sessionRef.current) return;
      try {
        const active = activePlayback();
        publish(sessionRef.current.tick(now, active), now, active);
        if (active) frame = requestAnimationFrame(tick);
      } catch {
        fail();
      }
    };
    const refresh = () => {
      if (disposed) return;
      cancelFrame();
      const shown = isVisible();
      setVisible(shown);
      try {
        const session = shown ? connect() : sessionRef.current;
        if (!session) return;
        const now = performance.now();
        // Freeze the session clock before returning from a hidden or paused view.
        publish(session.tick(now, false), now, false, true);
        if (shown && activePlayback()) frame = requestAnimationFrame(tick);
      } catch {
        fail();
      }
    };
    const resetView = () => {
      // The facade owns seek/emptied resets. Only invalidate stale UI/export work here.
      cancelFrame();
      revisionRef.current++;
      setRevision(revisionRef.current);
      const resting = emptySnapshot();
      setSnapshot(resting);
      setCode("");
      onFrameRef.current(resting, false, performance.now());
    };
    refreshRef.current = refresh;
    setConnection(available && audio ? "waiting" : "unavailable");
    onFrameRef.current(emptySnapshot(), false, performance.now());

    const observer = typeof IntersectionObserver === "undefined" || !hostRef.current
      ? null
      : new IntersectionObserver(([entry]) => {
        onScreen = Boolean(entry?.isIntersecting && entry.intersectionRatio > 0);
        refresh();
      }, { threshold: 0.01 });
    if (hostRef.current) observer?.observe(hostRef.current);
    const readyEvents = [AUDIO_ANALYSIS_READY, "canplay", "playing", "play", "pause", "seeked", "ended"];
    readyEvents.forEach(event => audio?.addEventListener(event, refresh));
    audio?.addEventListener("seeking", resetView);
    audio?.addEventListener("emptied", resetView);
    document.addEventListener("visibilitychange", refresh);
    refresh();

    return () => {
      disposed = true;
      cancelFrame();
      observer?.disconnect();
      readyEvents.forEach(event => audio?.removeEventListener(event, refresh));
      audio?.removeEventListener("seeking", resetView);
      audio?.removeEventListener("emptied", resetView);
      document.removeEventListener("visibilitychange", refresh);
      refreshRef.current = () => undefined;
      failedRef.current = () => undefined;
      revisionRef.current++;
      try { sessionRef.current?.dispose(); } catch { /* Playback belongs to the parent graph. */ }
      sessionRef.current = null;
    };
  }, [audio, available, hostRef]);

  useEffect(() => {
    playingRef.current = playing;
    refreshRef.current();
  }, [playing]);

  return {
    snapshot, code, connection, visible, revision, sessionRef, revisionRef,
    retry: () => refreshRef.current(),
    tap: () => {
      try {
        if (!playingRef.current || document.hidden) return;
        sessionRef.current?.tap(performance.now());
        refreshRef.current();
      } catch {
        failedRef.current();
      }
    },
  };
}
