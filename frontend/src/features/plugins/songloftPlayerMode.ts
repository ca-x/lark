import type { PlayMode } from "../../types/app";

export type SongloftPlayMode = "order" | "loop" | "single" | "random" | "singlePlay";

export function toSongloftPlayMode(mode: PlayMode): SongloftPlayMode {
  switch (mode) {
    case "shuffle":
      return "random";
    case "repeat-one":
      return "single";
    case "order":
      return "order";
    case "single-play":
      return "singlePlay";
    case "sequence":
      return "loop";
  }
}

export function fromSongloftPlayMode(mode: SongloftPlayMode): PlayMode {
  switch (mode) {
    case "random":
      return "shuffle";
    case "single":
      return "repeat-one";
    case "order":
      return "order";
    case "singlePlay":
      return "single-play";
    case "loop":
      return "sequence";
  }
}
