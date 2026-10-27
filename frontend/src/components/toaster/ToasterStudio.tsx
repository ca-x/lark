import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowSquareOut, ChartBar, Check, Circle, Code, Copy,
  DownloadSimple, Eye, EyeSlash, HandTap, Pause, Play, SpeakerHigh,
  SquaresFour, WarningCircle, Waveform,
} from "@phosphor-icons/react";
import { createT, type TKey } from "../../i18n";
import type { ToasterCodeLine, ToasterSnapshot, ToasterStudioProps, ToasterVisualMode } from "../../features/toaster/contracts";
import { strudelLink } from "../../features/toaster/session";
import ToasterVisualizer, { type ToasterVisualizerHandle } from "./ToasterVisualizer";
import { useToasterPlayback } from "./useToasterPlayback";
import { exportFilename, visibleCodeParts } from "./workspace";
import "./toaster-studio.css";

const modes: { mode: ToasterVisualMode; label: TKey; icon: typeof ChartBar }[] = [
  { mode: "spectrum", label: "toasterSpectrum", icon: ChartBar },
  { mode: "orb", label: "toasterOrb", icon: Circle },
  { mode: "dominoes", label: "toasterDominoes", icon: SquaresFour },
];

function CodeLine({ line, number, animate, active }: { line: ToasterCodeLine; number: number; animate: boolean; active: boolean }) {
  const previousRef = useRef("");
  const [visible, setVisible] = useState(() => animate ? Math.max(0, line.text.length - 48) : line.text.length);
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = line.text;
    if (!animate || previous === line.text) {
      setVisible(line.text.length);
      return;
    }
    let prefix = 0;
    while (prefix < previous.length && prefix < line.text.length && previous[prefix] === line.text[prefix]) prefix++;
    const start = Math.max(prefix, line.text.length - 48);
    setVisible(start);
    let timer = 0;
    let step = 0;
    const reveal = () => {
      step++;
      setVisible(Math.ceil(start + (line.text.length - start) * step / 4));
      if (step < 4) timer = window.setTimeout(reveal, 35);
    };
    timer = window.setTimeout(reveal, 35);
    return () => window.clearTimeout(timer);
  }, [line.text, animate]);
  return (
    <span className="toaster-code-line" data-comment={line.text.trimStart().startsWith("//")}>
      <span className="toaster-line-number" aria-hidden="true">{String(number).padStart(2, "0")}</span>
      <code>{visibleCodeParts(line, visible).map((part, index) => (
        <span key={index} className="toaster-code-part" data-active={active && part.active}>{part.text}</span>
      ))}{!line.text ? "\u00a0" : null}</code>
    </span>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export default function ToasterStudio({ audio, playing, available, meta, language, onBack, onTogglePlayback, onEnableAnalysis }: ToasterStudioProps) {
  const t = createT(language);
  const titleID = useId();
  const codeID = useId();
  const midiReasonID = useId();
  const hostRef = useRef<HTMLElement>(null);
  const visualRef = useRef<ToasterVisualizerHandle>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const downloadsRef = useRef(new Map<string, number>());
  const [mode, setMode] = useState<ToasterVisualMode>("spectrum");
  const [showCode, setShowCode] = useState(true);
  const [midiBusy, setMidiBusy] = useState(false);
  const [notice, setNotice] = useState<{ key: TKey; error: boolean } | null>(null);
  const [manualCopy, setManualCopy] = useState("");
  const [signalRecovery, setSignalRecovery] = useState<{ audio: HTMLAudioElement; mediaKey: string; revision: number } | null>(null);
  const reducedMotion = useReducedMotion();
  const onFrame = useCallback((snapshot: ToasterSnapshot, active: boolean, now: number) => {
    visualRef.current?.draw(snapshot, active, now);
  }, []);
  const playback = useToasterPlayback({ audio, playing, available, meta, hostRef, onFrame });
  const { snapshot, code, connection, visible, revision, sessionRef, revisionRef } = playback;
  const editorURL = useMemo(() => code ? strudelLink(code) : undefined, [code]);
  const hasSignal = playing && available && visible && connection === "ready" && snapshot.energy > 0.002;
  const waitingForSignal = Boolean(available && audio && visible && playing && connection === "ready" && !hasSignal);
  const showSignalRecovery = waitingForSignal && signalRecovery?.audio === audio && signalRecovery?.mediaKey === meta.mediaKey && signalRecovery?.revision === revision;
  const currentMode = modes.find(item => item.mode === mode) || modes[0];
  const formatNumber = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const bpm = snapshot.bpm !== null && Number.isFinite(snapshot.bpm) && snapshot.bpm > 0 ? formatNumber.format(snapshot.bpm) : t("toasterUnmeasured");
  const recorded = t("toasterRecordedBars").replace("{count}", String(snapshot.recordedBars));
  const canExportMidi = connection === "ready" && snapshot.recordedBars >= 4 && !midiBusy;
  const midiReason = midiBusy ? t("toasterMidiExporting") : connection !== "ready" ? t("toasterMidiNeedsLocalAudio") : snapshot.recordedBars < 4 ? t("toasterMidiNeedsBars") : recorded;
  const statusKey: TKey = !available || !audio ? "toasterUnavailable"
    : connection === "error" ? "toasterAnalysisFailed"
    : connection === "waiting" ? "toasterWaiting"
    : !playing ? "toasterPaused"
    : !hasSignal ? "toasterSilent"
    : snapshot.bpm === null ? "toasterListening" : "toasterLive";
  const sourceBlocked = !available || !audio || connection === "waiting" || connection === "error";

  useEffect(() => {
    setSignalRecovery(null);
    if (!waitingForSignal || !audio) return;
    const timer = window.setTimeout(() => setSignalRecovery({ audio, mediaKey: meta.mediaKey, revision }), 1500);
    return () => window.clearTimeout(timer);
  }, [waitingForSignal, audio, meta.mediaKey, revision]);

  useEffect(() => {
    setMidiBusy(false);
    setNotice(null);
    setManualCopy("");
  }, [revision]);

  useEffect(() => {
    if (!manualCopy) return;
    fallbackRef.current?.focus();
    fallbackRef.current?.select();
  }, [manualCopy]);

  useEffect(() => {
    const downloads = downloadsRef.current;
    return () => {
      for (const [url, timer] of downloads) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.clear();
    };
  }, []);

  const download = (content: BlobPart, type: string, filename: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const release = () => {
      URL.revokeObjectURL(url);
      downloadsRef.current.delete(url);
    };
    const timer = window.setTimeout(release, 1000);
    downloadsRef.current.set(url, timer);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  };

  const copyCode = async () => {
    if (!code) return;
    const epoch = revisionRef.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(code);
      if (epoch !== revisionRef.current) return;
      setManualCopy("");
      setNotice({ key: "toasterCopied", error: false });
    } catch {
      if (epoch !== revisionRef.current) return;
      setShowCode(true);
      setManualCopy(code);
      setNotice({ key: "toasterCopyFailed", error: true });
    }
  };

  const downloadCode = () => {
    if (!code) return;
    try {
      download(code, "text/plain;charset=utf-8", exportFilename(meta, "strudel"));
      setNotice({ key: "toasterDownloadStarted", error: false });
    } catch {
      setNotice({ key: "toasterCodeDownloadFailed", error: true });
    }
  };

  const downloadMidi = async () => {
    const session = sessionRef.current;
    if (!session || !canExportMidi) return;
    const epoch = revisionRef.current;
    setMidiBusy(true);
    setNotice(null);
    try {
      const files = await session.songFiles();
      if (epoch !== revisionRef.current || session !== sessionRef.current) return;
      if (!files || !files.midi.length) {
        setNotice({ key: "toasterMidiNeedsBars", error: true });
        return;
      }
      download(new Uint8Array(files.midi), "audio/midi", exportFilename(meta, "mid"));
      setNotice({ key: "toasterDownloadStarted", error: false });
    } catch {
      if (epoch === revisionRef.current) setNotice({ key: "toasterMidiExportFailed", error: true });
    } finally {
      if (epoch === revisionRef.current) setMidiBusy(false);
    }
  };

  const enableAnalysis = () => {
    try {
      onEnableAnalysis();
      playback.retry();
    } catch {
      setNotice({ key: "toasterAnalysisFailed", error: true });
    }
  };

  return (
    <section className="toaster-studio" ref={hostRef} aria-labelledby={titleID}>
      <header className="toaster-heading">
        <div className="toaster-heading-start">
          <button type="button" className="toaster-button toaster-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" /><span>{t("toasterBack")}</span>
          </button>
          <div className="toaster-title"><Waveform aria-hidden="true" weight="bold" /><h1 id={titleID}>{t("toasterStudio")}</h1></div>
        </div>
        <div className="toaster-player-actions">
          <button type="button" className="toaster-button" aria-expanded={showCode} aria-controls={codeID} onClick={() => setShowCode(value => !value)}>
            {showCode ? <EyeSlash aria-hidden="true" /> : <Eye aria-hidden="true" />}<span>{t(showCode ? "toasterHideCode" : "toasterShowCode")}</span>
          </button>
          <button type="button" className="toaster-button toaster-play" onClick={onTogglePlayback} disabled={!audio || !meta.mediaKey}>
            {playing ? <Pause aria-hidden="true" weight="fill" /> : <Play aria-hidden="true" weight="fill" />}<span>{t(playing ? "pause" : "play")}</span>
          </button>
        </div>
      </header>
      <p className="toaster-description">{t("toasterApproximate")}</p>

      <div className="toaster-workspace" data-code-visible={showCode}>
        <div className="toaster-trackbar">
          <div className="toaster-track">
            <span className="toaster-label">{t("nowPlaying")}</span>
            <h2>{meta.title || t("toasterNoTrack")}</h2>
            <p>{meta.artist || t("toasterUnknownArtist")}</p>
          </div>
          <dl className="toaster-metrics" aria-label={t("toasterMeasuredStatus")}>
            <div><dt>{t("toasterTempo")}</dt><dd>{bpm}</dd></div>
            <div><dt>{t("toasterKey")}</dt><dd>{snapshot.key || t("toasterUnmeasured")}</dd></div>
            <div><dt>{t("toasterBar")}</dt><dd>{snapshot.bar === null || snapshot.bar < 0 ? t("toasterUnmeasured") : snapshot.bar + 1}</dd></div>
          </dl>
        </div>

        <div className="toaster-stage">
          <section className="toaster-visual-side" aria-label={t("toasterVisuals")}>
            <div className="toaster-signal-status" data-active={hasSignal}>
              <span className="toaster-signal-mark" aria-hidden="true" />
              <span className="toaster-signal-copy"><span>{t(statusKey)}</span>{reducedMotion ? <small>{t("toasterReducedMotion")}</small> : null}</span>
              <button type="button" className="toaster-button toaster-signal-retry" aria-hidden={!showSignalRecovery} disabled={!showSignalRecovery} onClick={enableAnalysis}><span>{t("toasterRetryAnalysis")}</span></button>
            </div>
            <div className="toaster-visual-wrap">
              <ToasterVisualizer ref={visualRef} mode={mode} reducedMotion={reducedMotion} label={`${t("toasterVisuals")}: ${t(currentMode.label)}`} unavailableLabel={t("toasterVisualUnavailable")} />
              {sourceBlocked ? (
                <div className="toaster-source-state">
                  {connection === "error" ? <WarningCircle aria-hidden="true" size={27} /> : <SpeakerHigh aria-hidden="true" size={27} />}
                  <strong>{t(statusKey)}</strong>
                  <p>{t(!available || !audio ? "toasterLocalOnly" : connection === "error" ? "toasterAnalysisFailedHint" : "toasterWaitingHint")}</p>
                  {available && audio ? <button type="button" className="toaster-button toaster-connect" onClick={enableAnalysis}>{t(connection === "error" ? "toasterRetryAnalysis" : "toasterEnableAnalysis")}</button> : null}
                </div>
              ) : null}
            </div>
            <div className="toaster-visual-controls">
              <div className="toaster-modes" role="group" aria-label={t("toasterVisuals")}>
                {modes.map(({ mode: value, label, icon: Icon }) => (
                  <button type="button" key={value} aria-pressed={mode === value} onClick={() => setMode(value)}><Icon aria-hidden="true" /><span>{t(label)}</span></button>
                ))}
              </div>
              <button type="button" className="toaster-tap" title={t("toasterTapTempoHint")} disabled={connection !== "ready" || !playing || !visible} onClick={playback.tap}><HandTap aria-hidden="true" /><span>{t("toasterTapTempo")}</span></button>
            </div>
          </section>

          <section className="toaster-code" id={codeID} hidden={!showCode} aria-label={t("toasterCode")}>
            <div className="toaster-code-heading"><Code aria-hidden="true" /><h3>{t("toasterCode")}</h3><span>{t(snapshot.locked ? "toasterTempoLocked" : "toasterTempoLearning")}</span></div>
            {code ? (
              <pre className="toaster-code-content" tabIndex={0} aria-label={t("toasterCode")}>
                {snapshot.lines.length ? snapshot.lines.map((line, index) => <CodeLine key={line.id} line={line} number={index + 1} animate={showCode && playing && visible && !reducedMotion} active={hasSignal} />) : <code>{code}</code>}
              </pre>
            ) : <div className="toaster-code-empty"><Code aria-hidden="true" size={28} /><p>{t("toasterNoCode")}</p></div>}
            <div className="toaster-code-footer"><span>{recorded}</span><span>{t("toasterCodeFormat")}</span></div>
          </section>
        </div>
      </div>

      <div className="toaster-export-actions" role="group" aria-label={t("toasterExportActions")}>
        <button type="button" className="toaster-button toaster-copy" disabled={!code} onClick={() => { void copyCode(); }}><Copy aria-hidden="true" /><span>{t("toasterCopy")}</span></button>
        <button type="button" className="toaster-button" disabled={!code} onClick={downloadCode}><DownloadSimple aria-hidden="true" /><span>{t("toasterDownloadCode")}</span></button>
        <button type="button" className="toaster-button" disabled={!canExportMidi} aria-describedby={midiReasonID} aria-busy={midiBusy} onClick={() => { void downloadMidi(); }}><DownloadSimple aria-hidden="true" /><span>{t(midiBusy ? "toasterMidiExporting" : "toasterDownloadMidi")}</span></button>
        <a className="toaster-button" href={editorURL} target="_blank" rel="noopener noreferrer" aria-disabled={!code} title={t("toasterOpenStrudelHint")}><ArrowSquareOut aria-hidden="true" /><span>{t("toasterOpenStrudel")}</span></a>
      </div>
      <p className="toaster-export-hint" id={midiReasonID}>{midiReason}</p>
      {notice ? <p className="toaster-notice" data-error={notice.error} role="status">{notice.error ? <WarningCircle aria-hidden="true" /> : <Check aria-hidden="true" />}<span>{t(notice.key)}</span></p> : null}
      {manualCopy ? <label className="toaster-manual-copy"><span>{t("toasterManualCopy")}</span><textarea ref={fallbackRef} value={manualCopy} readOnly spellCheck={false} onFocus={event => event.currentTarget.select()} /></label> : null}
    </section>
  );
}
