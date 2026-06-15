import type { CSSProperties } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";

import type { PlayerThemePlayMode } from "./types";
import { useCoverFallback } from "./useCoverFallback";

const RUNNING_KITTEN_PATH =
  "M773.467429 358.454857c86.272-15.469714 142.189714-76.745143 139.958857-123.172571-3.584-74.953143-57.691429-112.621714-174.336-113.097143h-1.499429a25.417143 25.417143 0 0 1-25.307428-22.637714 21.833143 21.833143 0 0 1 20.461714-24.210286l4.242286-0.256c34.706286-2.194286 73.069714-3.474286 93.769142 1.426286 86.308571 20.461714 134.217143 72.502857 138.24 156.105142 3.2 66.486857-46.262857 131.474286-115.876571 182.857143a100.845714 100.845714 0 0 1-2.029714 1.462857c13.476571 23.588571 22.089143 49.92 25.874285 79.030858 13.129143 84.260571 0.914286 136.667429 10.276572 171.373714 9.380571 34.724571 52.041143 53.76 68.882286 92.544 16.822857 38.765714 13.714286 55.771429 8.777142 86.308571-2.907429 18.102857-9.490286 44.580571-19.712 79.396572a18.541714 18.541714 0 0 1-17.792 13.312h-61.641142c-10.24 0-18.541714-8.301714-18.541715-18.541715v-9.325714a18.541714 18.541714 0 0 1 18.742857-18.541714c8.32 0.109714 15.414857-2.084571 21.284572-6.582857 14.829714-11.337143 16.054857-17.664 16.054857-39.716572 0-14.701714-5.339429-29.494857-16.054857-44.379428-42.971429-27.940571-78.902857-49.773714-110.610286-65.828572-3.254857 32.219429-9.691429 61.513143-19.254857 87.881143-10.057143 27.721143-27.538286 62.994286-52.425143 105.801143a18.541714 18.541714 0 0 1-16.036571 9.234286h-48.786286c-10.057143 0-18.285714-8.009143-18.523429-18.066286l-0.219428-8.411429a18.541714 18.541714 0 0 1 17.664-19.017142l25.508571-1.206858c7.533714-0.365714 14.098286-5.248 16.603429-12.361142 8.448-23.990857 11.922286-47.561143 10.422857-70.729143-1.718857-26.130286-10.404571-61.750857-26.075429-106.898286-65.097143-0.585143-197.156571 27.666286-227.565714 30.189714-7.168 0.603429-14.537143 0.548571-22.089143-0.109714a257.883429 257.883429 0 0 0-11.392 59.209143c-1.883429 24.338286-2.048 67.145143-0.512 128.402286a18.541714 18.541714 0 0 1-18.541714 18.998857h-50.669714c-10.24 0-18.541714-8.301714-18.541715-18.541715v-12.726857c0-10.24 8.301714-18.541714 18.541715-18.541714h7.808a17.993143 17.993143 0 0 0 16.896-24.173714 508.617143 508.617143 0 0 1-22.326857-79.890286l-60.928 142.628571c-2.925714 6.820571-9.636571 11.245714-17.060572 11.245715h-67.291428c-10.24 0-18.56-8.301714-18.56-18.541715v-9.472c0-8.996571 6.454857-16.694857 15.305142-18.249142l32.036572-5.686858c4.022857-0.731429 7.716571-2.742857 10.477714-5.778285 13.019429-14.317714 21.394286-32.164571 25.161143-53.522286 9.289143-52.681143 15.177143-58.386286 0-109.037714-4.937143-16.548571-41.179429-32.676571-64.365714-105.984-14.866286-46.921143-28.032-126.628571-39.533715-239.122286a18.541714 18.541714 0 0 0-15.469714-16.420571l-35.620571-5.76c-5.485714-0.896-10.294857-4.205714-13.092572-9.014858L59.977143 293.595429a18.541714 18.541714 0 0 0-0.768-1.225143A22.674286 22.674286 0 0 1 54.857143 279.350857c0-3.584 0.932571-7.277714 2.797714-11.099428 0.987429-2.011429 2.322286-3.84 3.968-5.376l36.845714-34.614858c2.56-2.432 4.406857-5.540571 5.284572-8.96l2.084571-8.283428c1.865143-7.369143 5.961143-14.006857 11.702857-18.980572 11.081143-9.545143 19.254857-15.945143 24.539429-19.2 6.582857-4.041143 20.260571-8.905143 40.996571-14.555428-10.532571-14.738286-16.310857-27.629714-17.334857-38.692572-1.554286-16.585143-2.870857-33.005714 3.84-33.645714 4.498286-0.420571 15.872 11.940571 34.139429 37.083429-1.426286-31.762286 1.773714-45.805714 9.636571-42.093715 7.862857 3.693714 25.088 25.106286 51.748572 64.237715l26.002285 29.622857a129.792 129.792 0 0 1 27.209143 49.792c13.129143 45.714286 25.636571 78.610286 37.485715 98.724571 21.193143 35.876571 47.177143 80.054857 131.620571 73.508572 84.425143-6.528 112.822857-23.625143 169.069714-32.475429a799.451429 799.451429 0 0 1 86.893715-8.429714 115.931429 115.931429 0 0 1 30.08 2.541714z";

export function RunningKittenTurntable({
  cover,
  playing,
  progress = 0,
  duration = 0,
  title = "Lark",
  artist = "Sonora",
  playMode = "sequence",
  playModeLabel = "Play mode",
  onToggle,
  onPrevious,
  onNext,
  onCyclePlayMode,
  onSeek,
}: {
  cover?: string;
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
}) {
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const endWindowSeconds = Math.max(8, Math.min(18, duration * 0.08 || 8));
  const secondsLeft = duration > 0 ? Math.max(0, duration - progress) : Number.POSITIVE_INFINITY;
  const endingPct = Number.isFinite(secondsLeft) ? Math.max(0, Math.min(1, (endWindowSeconds - secondsLeft) / endWindowSeconds)) : 0;
  const isAtEnd = duration > 0 && progress >= duration - 0.2;
  const active = playing && !isAtEnd;
  const coverState = useCoverFallback(cover);
  const spinSeconds = (6.8 * (1 + endingPct * 1.7)).toFixed(2);
  const tonearmAngle = 21 - pct * 18;
  const style = {
    "--running-kitten-progress-pct": `${(pct * 100).toFixed(2)}%`,
    "--running-kitten-spin-duration": `${spinSeconds}s`,
    "--running-kitten-arm-angle": `${tonearmAngle.toFixed(2)}deg`,
  } as CSSProperties;
  const modeIcon =
    playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;

  return (
    <div className="running-kitten-player" data-playing={active ? "true" : "false"} style={style}>
      <div className="running-kitten-scene" aria-hidden="true">
        <div className="running-kitten-watercolor" />
        <div className="running-kitten-sun" />
        <div className="running-kitten-horizon" />
        <div className="running-kitten-trail" />
        <div className="running-kitten-platter">
          <div className="running-kitten-record">
            <div className="running-kitten-grooves" />
            <div className="running-kitten-record-sheen" />
            <div className="running-kitten-label" data-has-cover={coverState.displayUrl ? "true" : "false"}>
              {coverState.displayUrl ? <img src={coverState.displayUrl} alt="" onError={coverState.onCoverError} /> : null}
              <span>{title}</span>
            </div>
          </div>
          <div className="running-kitten-spindle" />
        </div>
        <div className="running-kitten-cat-track">
          <div className="running-kitten-cat-runner">
            <KittenSilhouette />
          </div>
        </div>
        <WatercolorTonearm />
      </div>

      <div className="running-kitten-console">
        <span className="running-kitten-kicker">Watercolor vinyl</span>
        <h2>{title}</h2>
        <p>{artist}</p>
        <div className="running-kitten-progress">
          <div className="running-kitten-time">
            <time>{formatRunningKittenTime(progress)}</time>
            <time>{formatRunningKittenTime(duration || 0)}</time>
          </div>
          <div className="running-kitten-progress-rail">
            <span><i /></span>
            <input
              aria-label="Position"
              type="range"
              min="0"
              max={Math.max(0, duration || 0)}
              step="0.01"
              value={Math.min(progress, duration || progress || 0)}
              disabled={!duration || !onSeek}
              onChange={(event) => onSeek?.(Number(event.target.value))}
            />
          </div>
        </div>
        <div className="running-kitten-controls">
          <button type="button" aria-label="Previous" disabled={!onPrevious} onClick={onPrevious}>
            <SkipBack weight="fill" />
          </button>
          <button type="button" className="running-kitten-play" aria-label={playing ? "Pause" : "Play"} disabled={!onToggle} onClick={onToggle}>
            {playing ? <Pause weight="fill" /> : <Play weight="fill" />}
          </button>
          <button type="button" aria-label="Next" disabled={!onNext} onClick={onNext}>
            <SkipForward weight="fill" />
          </button>
          <button type="button" className={playMode === "sequence" ? "" : "active"} aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>
            {modeIcon}
          </button>
        </div>
      </div>
    </div>
  );
}

function KittenSilhouette() {
  return (
    <svg className="running-kitten-cat" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d={RUNNING_KITTEN_PATH} />
    </svg>
  );
}

function WatercolorTonearm() {
  return (
    <div className="running-kitten-arm">
      <span className="running-kitten-arm-base" />
      <span className="running-kitten-arm-wand" />
      <span className="running-kitten-arm-head">
        <i />
      </span>
    </div>
  );
}

function formatRunningKittenTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
