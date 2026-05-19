export type AudioOutputSnapshot = {
  deviceIds: Set<string>;
  labels: Set<string>;
  headphoneLabels: Set<string>;
  specificCount: number;
  totalCount: number;
};

const HEADPHONE_OUTPUT_PATTERN =
  /(headphone|headset|earphone|earbud|airpods?|beats|bluetooth|bt|buds|耳机|蓝牙|耳塞)/i;

export function audioOutputSnapshot(devices: MediaDeviceInfo[]): AudioOutputSnapshot {
  const outputs = devices.filter((device) => device.kind === "audiooutput");
  const specificOutputs = outputs.filter(
    (device) => device.deviceId && !["default", "communications"].includes(device.deviceId),
  );
  const labels = new Set(
    specificOutputs
      .map((device) => device.label.trim().toLowerCase())
      .filter(Boolean),
  );
  const headphoneLabels = new Set(
    Array.from(labels).filter((label) => HEADPHONE_OUTPUT_PATTERN.test(label)),
  );
  return {
    deviceIds: new Set(specificOutputs.map((device) => device.deviceId)),
    labels,
    headphoneLabels,
    specificCount: specificOutputs.length,
    totalCount: outputs.length,
  };
}

export function prepareAudioForBackgroundPlayback(audio: HTMLAudioElement | null) {
  if (audio) audio.preload = "auto";
}

export function resumeAudioContext(ctx: AudioContext | null) {
  if (ctx?.state === "suspended") void ctx.resume().catch(() => undefined);
}

export function shouldResumePlaybackOnForeground(
  audio: HTMLAudioElement,
  isPlaying: boolean,
  visibilityState: DocumentVisibilityState,
) {
  return visibilityState === "visible" && isPlaying && audio.paused && !audio.ended;
}

export function shouldPauseForAudioOutputDisconnect(
  previous: AudioOutputSnapshot | null,
  next: AudioOutputSnapshot,
  isPlaying: boolean,
  visibilityState: DocumentVisibilityState,
) {
  return Boolean(
    previous &&
      isPlaying &&
      visibilityState === "visible" &&
      audioOutputDisconnected(previous, next),
  );
}

function setHasLostItem(previous: Set<string>, next: Set<string>) {
  for (const item of previous) {
    if (!next.has(item)) return true;
  }
  return false;
}

function audioOutputDisconnected(previous: AudioOutputSnapshot, next: AudioOutputSnapshot) {
  if (next.totalCount === 0) return false;
  if (previous.headphoneLabels.size > 0) {
    return setHasLostItem(previous.headphoneLabels, next.headphoneLabels);
  }
  if (previous.deviceIds.size > 0 && next.deviceIds.size > 0) {
    return setHasLostItem(previous.deviceIds, next.deviceIds);
  }
  return false;
}
