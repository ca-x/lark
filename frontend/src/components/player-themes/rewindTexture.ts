import type { RewindTheme } from "../../types";

export const TAPE_MATERIALS = {
  "rewind-classic": { shell: "#aaa9a3", edge: "#686963", insert: "#464943", paper: "#eeece3", ink: "#343832", stripe: "#a58a4e" },
  "rewind-studio": { shell: "#cf514b", edge: "#762d2e", insert: "#8f302e", paper: "#f0e9df", ink: "#443a34", stripe: "#d7ad42" },
  "rewind-crystal": { shell: "#a9cbd5", edge: "#56777f", insert: "#3f727c", paper: "#edf0e9", ink: "#31454b", stripe: "#b2c8ad" },
} as const;

export type TapePrint = { variant: RewindTheme; title: string; artist: string; album: string; cover?: string };

function fitText(context: CanvasRenderingContext2D, text: string, width: number) {
  if (context.measureText(text).width <= width) return text;
  let end = text.length;
  while (end > 0 && context.measureText(`${text.slice(0, end)}…`).width > width) end--;
  return `${text.slice(0, end)}…`;
}

export function paintTape(canvas: HTMLCanvasElement, record: TapePrint, image?: HTMLImageElement, thumbnail = false, side = "A") {
  canvas.width = thumbnail ? 500 : 1000;
  canvas.height = thumbnail ? 320 : 640;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(thumbnail ? .5 : 1, 0, 0, thumbnail ? .5 : 1, 0, 0);
  const palette = TAPE_MATERIALS[record.variant];
  context.clearRect(0, 0, 1000, 640);
  if (thumbnail) {
    const shell = context.createLinearGradient(0, 0, 0, 640);
    shell.addColorStop(0, "#e2e4dc"); shell.addColorStop(.03, palette.shell); shell.addColorStop(.9, palette.shell); shell.addColorStop(1, palette.edge);
    context.fillStyle = shell;
    context.beginPath(); context.roundRect(0, 0, 1000, 640, 24); context.fill();
  }
  context.fillStyle = palette.insert;
  context.fillRect(65, 188, 870, 304);
  if (image) {
    context.save();
    context.beginPath(); context.rect(65, 188, 870, 304); context.clip();
    const scale = Math.max(870 / image.naturalWidth, 304 / image.naturalHeight);
    context.globalAlpha = .52;
    context.drawImage(image, 500 - image.naturalWidth * scale / 2, 340 - image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
    context.restore();
    context.fillStyle = "#10201955"; context.fillRect(65, 188, 870, 304);
  }
  context.fillStyle = palette.paper;
  context.fillRect(65, 48, 870, 125);
  context.fillStyle = "#545b5022";
  for (let line = 0; line < 3; line++) context.fillRect(84, 88 + line * 29, 832, 1);
  context.font = "italic 36px Georgia, 'Songti SC', serif";
  context.fillStyle = palette.ink;
  context.fillText(fitText(context, record.album || record.title, 660), 89, 113);
  context.font = "13px sans-serif";
  context.fillText("LARK / PERSONAL RECORDINGS", 88, 153);
  context.textAlign = "right";
  context.fillText("NO. 001     /     IN · OUT", 909, 153);
  context.textAlign = "left";
  context.fillStyle = palette.stripe;
  context.fillRect(430, 190, 190, 12);
  context.fillStyle = "#ecefe5";
  context.font = "21px sans-serif";
  context.fillText(`${side} side`, 97, 244);
  context.font = "16px sans-serif";
  context.fillText("Noise", 798, 243); context.fillText("reduction", 798, 266);
  context.font = "bold 45px sans-serif";
  context.fillText("◉ LARK", 98, 455);
  context.font = "15px sans-serif";
  context.fillText("NORMAL BIAS 120μs EQ", 340, 453);
  context.font = "44px sans-serif";
  context.fillText("A90", 636, 456);
  context.font = "10px sans-serif";
  context.fillText("STEREO / TYPE I", 791, 457);
  context.fillStyle = "#ffffff20";
  for (let line = 0; line < 640; line += 4) context.fillRect(0, line, 1000, .45);
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = "#000";
  for (const center of [282, 718]) {
    context.beginPath(); context.arc(center, 320, 66, 0, Math.PI * 2); context.fill();
  }
  context.fillRect(394, 267, 212, 106);
  context.restore();
  if (thumbnail) {
    context.fillStyle = "#141917";
    context.fillRect(394, 267, 212, 106);
    for (const center of [282, 718]) {
      context.fillStyle = "#e5e6d7";
      context.beginPath(); context.arc(center, 320, 65, 0, Math.PI * 2); context.fill();
      context.fillStyle = "#131817";
      context.beginPath(); context.arc(center, 320, 51, 0, Math.PI * 2); context.fill();
      for (let tooth = 0; tooth < 6; tooth++) {
        context.save(); context.translate(center, 320); context.rotate(tooth * Math.PI / 3);
        context.fillStyle = "#e5e6d7"; context.fillRect(-5, -51, 10, 15); context.restore();
      }
    }
    context.strokeStyle = "#ffffff55"; context.lineWidth = 2;
    context.beginPath(); context.moveTo(247, 637); context.lineTo(276, 516); context.lineTo(724, 516); context.lineTo(753, 637); context.stroke();
    for (const center of [313, 405, 595, 687]) {
      context.fillStyle = "#202623"; context.beginPath(); context.arc(center, 574, 10, 0, Math.PI * 2); context.fill();
    }
  }
}

export function loadTapeImage(source: string, loaded: (image: HTMLImageElement) => void) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.onload = () => loaded(image);
  image.src = source;
  return () => { image.onload = null; image.onerror = null; };
}
