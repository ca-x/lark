import { useEffect, useState, type CSSProperties } from "react";
import {
  Dithering,
  DotGrid,
  DotOrbit,
  FlutedGlass,
  GemSmoke,
  GodRays,
  GrainGradient,
  HalftoneDots,
  LiquidMetal,
  MeshGradient,
  PulsingBorder,
  SmokeRing,
  Voronoi,
  Waves,
} from "@paper-design/shaders-react";

import type { MobileArtPlayerVariant } from "./types";

export type PaperShaderVariant =
  | "album-slide"
  | "audio-scope"
  | "vinyl"
  | "cassette"
  | "ipod"
  | "smartisan"
  | "gramophone"
  | "running-kitten"
  | "mineradio"
  | "walkman"
  | "mini"
  | "player-mood"
  | "lyrics"
  | `mobile-${MobileArtPlayerVariant}`;

type PaperShaderLayerProps = {
  variant: PaperShaderVariant;
  playing?: boolean;
  cover?: string;
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
};

function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function PaperShaderLayer({
  variant,
  playing = false,
  cover,
  compact = false,
  className = "",
  style,
}: PaperShaderLayerProps) {
  const reduced = useReducedMotion();
  const speed = reduced ? 0 : playing ? 0.58 : 0.06;
  const maxPixelCount = compact ? 180000 : 760000;
  const image = cover || undefined;
  const layerClass = [
    "paper-shader-layer",
    `paper-shader-${variant}`,
    reduced ? "paper-shader-static" : "",
    className,
  ].filter(Boolean).join(" ");
  const shaderBase = {
    className: "paper-shader-canvas",
    minPixelRatio: 1,
    maxPixelCount,
    width: "100%",
    height: "100%",
  };

  const content = reduced ? null : renderPaperShader(variant, speed, image, shaderBase);

  return (
    <span
      className={layerClass}
      data-paper-shader-variant={variant}
      data-paper-shader-playing={playing ? "true" : "false"}
      aria-hidden="true"
      style={style}
    >
      {content}
    </span>
  );
}

function renderPaperShader(
  variant: PaperShaderVariant,
  speed: number,
  image: string | undefined,
  shaderBase: {
    className: string;
    minPixelRatio: number;
    maxPixelCount: number;
    width: string;
    height: string;
  },
) {
  switch (variant) {
    case "album-slide":
      return (
        <MeshGradient
          {...shaderBase}
          fit="cover"
          colors={["#f6e7b5", "#d65f5f", "#273a6f", "#10131d"]}
          distortion={0.72}
          swirl={0.2}
          grainMixer={0.42}
          grainOverlay={0.18}
          speed={speed * 0.55}
        />
      );
    case "audio-scope":
      return (
        <Voronoi
          {...shaderBase}
          fit="cover"
          scale={1.15}
          colors={["#071829", "#0f4c81", "#2cc7d3", "#f0f9ff"]}
          colorGap="#02111d"
          colorGlow="#7de7ff"
          gap={0.026}
          glow={0.44}
          distortion={0.16}
          speed={speed * 0.75}
        />
      );
    case "vinyl":
      return (
        <PulsingBorder
          {...shaderBase}
          fit="cover"
          colorBack="#120904"
          colors={["#f2bf64", "#a74f23", "#251006", "#fff1bd"]}
          roundness={0.12}
          thickness={0.08}
          margin={0.035}
          softness={0.4}
          intensity={0.68}
          bloom={0.22}
          spots={0.54}
          spotSize={0.44}
          pulse={0.5}
          smoke={0.16}
          smokeSize={0.24}
          speed={speed * 0.42}
        />
      );
    case "cassette":
      return (
        <Dithering
          {...shaderBase}
          fit="cover"
          colorBack="#060a05"
          colorFront="#76d45a"
          shape="wave"
          type="4x4"
          size={4.4}
          scale={1.1}
          speed={speed * 0.66}
        />
      );
    case "ipod":
      return (
        <DotGrid
          {...shaderBase}
          fit="cover"
          colorBack="#d7e3dc"
          colorFill="#365f56"
          colorStroke="#f6fff9"
          size={2.8}
          gapX={8}
          gapY={8}
          strokeWidth={0.45}
          sizeRange={0.34}
          opacityRange={0.72}
          shape="square"
        />
      );
    case "smartisan":
      return (
        <LiquidMetal
          {...shaderBase}
          fit="cover"
          colorBack="#f4f4f1"
          colorTint="#d8d8d4"
          shape="circle"
          repetition={4.6}
          softness={0.34}
          distortion={0.28}
          contour={0.52}
          shiftRed={0.045}
          shiftBlue={-0.04}
          angle={24}
          scale={1.08}
          speed={speed * 0.35}
        />
      );
    case "gramophone":
      return (
        <SmokeRing
          {...shaderBase}
          fit="cover"
          colorBack="#130906"
          colors={["#f7d79b", "#c17a32", "#5b2c17", "#24100b"]}
          noiseScale={1.6}
          thickness={0.42}
          radius={0.46}
          innerShape={1.6}
          noiseIterations={5}
          scale={1.16}
          speed={speed * 0.36}
        />
      );
    case "running-kitten":
      return (
        <DotOrbit
          {...shaderBase}
          fit="cover"
          colorBack="#2a160c"
          colors={["#fff0bf", "#f0b356", "#d8753b", "#8fd6c2"]}
          size={0.22}
          sizeRange={0.54}
          spreading={0.62}
          stepsPerColor={2}
          scale={1.05}
          speed={speed * 0.74}
        />
      );
    case "mineradio":
      return (
        <>
          <GodRays
            {...shaderBase}
            fit="cover"
            colorBack="#010304"
            colorBloom="#9cffdf"
            colors={["#9cffdf", "#fff0b8", "#4cc9ff", "#0b1118"]}
            spotty={0.34}
            midSize={0.38}
            midIntensity={0.46}
            density={0.56}
            intensity={0.74}
            bloom={0.35}
            speed={speed * 0.5}
          />
          <GemSmoke
            {...shaderBase}
            className="paper-shader-canvas paper-shader-canvas-secondary"
            fit="cover"
            colorBack="#00000000"
            colors={["#9cffdf", "#fff0b8", "#173f4c"]}
            colorInner="#f7fbff"
            shape="circle"
            innerDistortion={0.48}
            outerDistortion={0.68}
            outerGlow={0.56}
            innerGlow={0.22}
            offset={0.1}
            size={0.58}
            speed={speed * 0.36}
          />
        </>
      );
    case "walkman":
      return (
        <>
          <GrainGradient
            {...shaderBase}
            fit="cover"
            colorBack="#07080d"
            colors={["#ff9e3d", "#c7cbd2", "#2d3340", "#090a0f"]}
            softness={0.62}
            intensity={0.52}
            noise={0.42}
            shape="corners"
            speed={speed * 0.32}
          />
          <GodRays
            {...shaderBase}
            className="paper-shader-canvas paper-shader-canvas-secondary"
            fit="cover"
            colorBack="#00000000"
            colorBloom="#ffb054"
            colors={["#ffb054", "#c7cbd2", "#111827"]}
            spotty={0.24}
            midSize={0.28}
            midIntensity={0.36}
            density={0.42}
            intensity={0.48}
            bloom={0.22}
            speed={speed * 0.28}
          />
        </>
      );
    case "mini":
      return (
        <PulsingBorder
          {...shaderBase}
          fit="cover"
          colorBack="#030405"
          colors={["#9cffdf", "#f6d58a", "#ffffff"]}
          roundness={0.36}
          thickness={0.1}
          margin={0.04}
          softness={0.46}
          intensity={0.54}
          bloom={0.16}
          spots={0.34}
          spotSize={0.26}
          pulse={0.42}
          smoke={0.08}
          smokeSize={0.18}
          speed={speed * 0.5}
        />
      );
    case "player-mood":
      return (
        <Waves
          {...shaderBase}
          fit="cover"
          colorFront="#8ff8d2"
          colorBack="#061015"
          rotation={-8}
          shape={2.4}
          frequency={1.18}
          amplitude={0.34}
          spacing={0.34}
          proportion={0.44}
          softness={0.56}
        />
      );
    case "lyrics":
      return (
        <>
          <MeshGradient
            {...shaderBase}
            fit="cover"
            colors={["#0d1018", "#6adfd0", "#f4d58a", "#8358ff", "#020305"]}
            distortion={0.82}
            swirl={0.34}
            grainMixer={0.45}
            grainOverlay={0.12}
            speed={speed * 0.42}
          />
          {image ? (
            <HalftoneDots
              {...shaderBase}
              className="paper-shader-canvas paper-shader-canvas-secondary"
              fit="cover"
              image={image}
              colorFront="#ffffff"
              colorBack="#000000"
              size={0.18}
              grid="hex"
              radius={0.72}
              contrast={0.48}
              originalColors
              grainMixer={0.38}
              grainOverlay={0.12}
              grainSize={0.3}
              type="soft"
              speed={speed * 0.18}
            />
          ) : null}
        </>
      );
    case "mobile-neon-console":
      return (
        <PulsingBorder
          {...shaderBase}
          fit="cover"
          colorBack="#050816"
          colors={["#70f7ff", "#ff4bb8", "#8d7cff"]}
          roundness={0.18}
          thickness={0.07}
          margin={0.04}
          softness={0.42}
          intensity={0.62}
          bloom={0.24}
          spots={0.5}
          spotSize={0.34}
          pulse={0.46}
          smoke={0.12}
          smokeSize={0.24}
          speed={speed * 0.58}
        />
      );
    case "mobile-indiewave":
      return (
        <GrainGradient
          {...shaderBase}
          fit="cover"
          colorBack="#f2d7a5"
          colors={["#fff0c5", "#ee8b58", "#526f9c", "#1d2a2f"]}
          softness={0.62}
          intensity={0.5}
          noise={0.42}
          shape="wave"
          speed={speed * 0.35}
        />
      );
    case "mobile-editorial-pulse":
      return (
        <DotGrid
          {...shaderBase}
          fit="cover"
          colorBack="#f5f2e8"
          colorFill="#252525"
          colorStroke="#ffffff"
          size={3}
          gapX={11}
          gapY={11}
          strokeWidth={0.35}
          sizeRange={0.18}
          opacityRange={0.62}
          shape="circle"
        />
      );
    case "mobile-soft-vinyl":
      return (
        <GrainGradient
          {...shaderBase}
          fit="cover"
          colorBack="#f7e2d5"
          colors={["#ffe6cf", "#dba07f", "#b86f86", "#6b778f"]}
          softness={0.78}
          intensity={0.34}
          noise={0.5}
          shape="blob"
          speed={speed * 0.22}
        />
      );
    case "mobile-gramophone":
      return (
        <SmokeRing
          {...shaderBase}
          fit="cover"
          colorBack="#1c0d07"
          colors={["#ffdfa3", "#bd7a37", "#6b3218"]}
          noiseScale={1.25}
          thickness={0.36}
          radius={0.42}
          innerShape={1.3}
          noiseIterations={4}
          speed={speed * 0.25}
        />
      );
    case "mobile-stage-glass":
      return (
        <FlutedGlass
          {...shaderBase}
          fit="cover"
          image={image}
          colorBack="#071015"
          colorShadow="#4dd8ff"
          colorHighlight="#f5fbff"
          shadows={0.44}
          highlights={0.72}
          size={0.18}
          shape="wave"
          angle={24}
          distortionShape="prism"
          distortion={0.58}
          shift={0.08}
          stretch={0.35}
          blur={0.14}
          edges={0.2}
          grainMixer={0.28}
          grainOverlay={0.1}
          speed={speed * 0.32}
        />
      );
    case "mobile-blue-halo":
      return (
        <Dithering
          {...shaderBase}
          fit="cover"
          colorBack="#031224"
          colorFront="#62d8ff"
          shape="ripple"
          type="8x8"
          size={5.5}
          scale={1.08}
          speed={speed * 0.44}
        />
      );
    case "mobile-smartisan-classic":
      return (
        <LiquidMetal
          {...shaderBase}
          fit="cover"
          colorBack="#f7f7f5"
          colorTint="#bfc0bd"
          shape="circle"
          repetition={3.8}
          softness={0.38}
          distortion={0.18}
          contour={0.45}
          shiftRed={0.035}
          shiftBlue={-0.03}
          angle={18}
          speed={speed * 0.24}
        />
      );
    default:
      return null;
  }
}
