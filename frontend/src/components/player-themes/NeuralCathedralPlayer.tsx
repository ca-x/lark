import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Pause, Play, Repeat, RepeatOnce, Shuffle, SkipBack, SkipForward } from "@phosphor-icons/react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { resolvePlayerThemeLabels, type PlayerThemeLabels, type PlayerThemePlayMode } from "./types";
import { createAnimationActivity, type AnimationActivity } from "./animationActivity";

type Props = {
  playing: boolean;
  progress?: number;
  duration?: number;
  title?: string;
  artist?: string;
  playMode?: PlayerThemePlayMode;
  playModeLabel?: string;
  labels?: PlayerThemeLabels;
  telemetryLabel?: string;
  manualOverrideLabel?: string;
  onToggle?: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onCyclePlayMode?: () => void;
  onSeek?: (seconds: number) => void;
};

export function NeuralCathedralPlayer({ playing, progress = 0, duration = 0, title = "Lark", artist = "Unknown artist", playMode = "sequence", playModeLabel = "Play mode", labels, telemetryLabel = "Player telemetry", manualOverrideLabel = "Manual override", onToggle, onPrevious, onNext, onCyclePlayMode, onSeek }: Props) {
  const [pulseNonce, setPulseNonce] = useState(0);
  const text = resolvePlayerThemeLabels(labels);
  const pct = duration > 0 ? Math.min(1, Math.max(0, progress / duration)) : 0;
  const playModeIcon = playMode === "shuffle" ? <Shuffle weight="bold" /> : playMode === "repeat-one" ? <RepeatOnce weight="bold" /> : <Repeat weight="bold" />;
  return (
    <div className="neural-cathedral-player" data-playing={playing ? "true" : "false"} style={{ "--neural-progress": `${(pct * 100).toFixed(2)}%` } as CSSProperties}>
      <NeuralCathedralCanvas playing={playing} pulseNonce={pulseNonce} />
      <span className="neural-cathedral-overlay" aria-hidden="true" />
      <div className="neural-cathedral-hud neural-cathedral-hud-left" aria-label={telemetryLabel}>
        <div className="neural-cathedral-hud-head"><strong>NEURAL CATHEDRAL</strong><small>ID: NC-09 // BIOELECTRIC ENGINE</small></div>
        <div><span>MEMBRANE V</span><b>{playing ? "+40.0 mV" : "-70.0 mV"}</b></div>
        <div><span>DENDRITE STATE</span><b className={playing ? "neural-value-active" : ""}>{playing ? "ACTIVE LOAD" : "CALM"}</b></div>
        <div><span>AXON LOAD</span><b className={playing ? "neural-value-active" : ""}>{playing ? "98%" : "02%"}</b></div>
        <div><span>SIGNAL PHASE</span><b className={playing ? "neural-value-active" : ""}>{playing ? "OUTFLOW" : "RESTING"}</b></div>
        <div><span>SYNAPTIC COH</span><b>{playing ? "85%" : "24%"}</b></div>
        <button type="button" className="neural-impulse" aria-label={manualOverrideLabel} onClick={() => setPulseNonce((value) => value + 1)}>MANUAL OVERRIDE</button>
      </div>
      <div className="neural-cathedral-copy"><span>LIVE SIGNAL</span><strong title={title}>{title}</strong><small title={artist}>{artist}</small></div>
      <div className="neural-cathedral-controls">
        <div className="neural-progress-row"><time>{formatTime(progress)}</time><input aria-label={text.position} type="range" min="0" max={Math.max(0, duration || 0)} step="0.01" value={Math.min(progress, duration || progress || 0)} disabled={!duration || !onSeek} onChange={(event) => onSeek?.(Number(event.target.value))} /><time>{formatTime(duration)}</time></div>
        <div className="neural-transport">
          <button type="button" aria-label={text.previous} disabled={!onPrevious} onClick={onPrevious}><SkipBack weight="fill" /></button>
          <button type="button" className="neural-play" aria-label={playing ? text.pause : text.play} disabled={!onToggle} onClick={onToggle}>{playing ? <Pause weight="fill" /> : <Play weight="fill" />}</button>
          <button type="button" aria-label={text.next} disabled={!onNext} onClick={onNext}><SkipForward weight="fill" /></button>
          <button type="button" aria-label={playModeLabel} title={playModeLabel} disabled={!onCyclePlayMode} onClick={onCyclePlayMode}>{playModeIcon}</button>
        </div>
      </div>
    </div>
  );
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "00:00";
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function NeuralCathedralCanvas({ playing, pulseNonce }: { playing: boolean; pulseNonce: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ playing, pulseNonce });
  useEffect(() => { stateRef.current = { playing, pulseNonce }; }, [playing, pulseNonce]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const markWebGLUnavailable = (error?: unknown) => {
      canvas.setAttribute("data-webgl-unavailable", "true");
      host.setAttribute("data-webgl-unavailable", "true");
      if (error) console.warn("Neural Cathedral WebGL unavailable; using the static signal field.", error);
      else console.warn("Neural Cathedral WebGL unavailable; using the static signal field.");
    };
    canvas.removeAttribute("data-webgl-unavailable");
    host.removeAttribute("data-webgl-unavailable");
    let activity: AnimationActivity | null = null;
    let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => { reduceMotion = event.matches; activity?.request(); };
    motionQuery.addEventListener("change", onMotionChange);
    const contextAttributes: WebGLContextAttributes = {
      alpha: true,
      antialias: false,
      powerPreference: "high-performance",
    };
    const context = canvas.getContext("webgl2", contextAttributes) || canvas.getContext("webgl", contextAttributes);
    if (!context) {
      markWebGLUnavailable();
      motionQuery.removeEventListener("change", onMotionChange);
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, ...contextAttributes });
    } catch (error) {
      markWebGLUnavailable(error);
      motionQuery.removeEventListener("change", onMotionChange);
      return;
    }
    const onContextLost = (event: Event) => {
      event.preventDefault();
      activity?.dispose();
      markWebGLUnavailable();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
    renderer.setClearColor(0x010204, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.domElement.setAttribute("aria-hidden", "true");
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x010204, 0.015);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    camera.position.set(30, 20, 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.04;
    controls.enablePan = false;
    controls.minDistance = 15;
    controls.maxDistance = 120;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.6;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.8, 0.6, 0.1);
    composer.addPass(bloomPass);

    const shaderNoise = `
      vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
      vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
      vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
      float snoise(vec3 v){
        const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
        vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx); vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
        vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy); vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
        i=mod289(i); vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
        float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
        vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y); vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
        vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0)); vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
        vec3 p0=vec3(a0.xy,h.x),p1=vec3(a0.zw,h.y),p2=vec3(a1.xy,h.z),p3=vec3(a1.zw,h.w); vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
        p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w; vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m*=m;
        return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
      }
    `;
    const uniforms = {
      uTime: { value: 0 }, uPhase: { value: 0 }, uProgress: { value: 0 },
      uColCyan: { value: new THREE.Color("#00e5ff") }, uColBlue: { value: new THREE.Color("#0033aa") },
      uColGold: { value: new THREE.Color("#ffaa00") }, uColOrange: { value: new THREE.Color("#ff4400") },
      uColMagenta: { value: new THREE.Color("#ff0066") }, uColViolet: { value: new THREE.Color("#6600ff") },
      uSomaRadius: { value: 4 }, uMaxDistDendrite: { value: 35 }, uMaxDistAxon: { value: 50 },
    };
    const network = new THREE.Group();
    scene.add(network);
    const somaMaterial = new THREE.ShaderMaterial({ uniforms, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, vertexShader: `${shaderNoise}
      uniform float uTime; uniform int uPhase; uniform float uProgress; varying vec3 vNormal; varying vec3 vViewPosition; varying float vNoise;
      void main(){vec3 pos=position;float noise=snoise(pos*0.5+uTime*0.3)*0.5;float burst=uPhase==2?sin(uProgress*3.14159)*0.4:0.0;pos+=normal*(noise+burst);vNoise=noise;vNormal=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(pos,1.0);vViewPosition=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform int uPhase; uniform float uProgress; uniform vec3 uColCyan; uniform vec3 uColBlue; uniform vec3 uColGold; uniform vec3 uColMagenta; varying vec3 vNormal; varying vec3 vViewPosition; varying float vNoise;
      void main(){vec3 n=normalize(vNormal),v=normalize(vViewPosition);float f=pow(1.0-max(dot(n,v),0.0),2.5);vec3 c=mix(uColBlue*0.2,uColCyan,f)+uColCyan*(vNoise*0.5+0.5)*0.3;if(uPhase==2){float i=sin(uProgress*3.14159);c=mix(c,uColGold*2.0+uColCyan,i*f*2.0)+uColGold*i*(1.0-f);}else if(uPhase==4)c=mix(c,uColMagenta,(1.0-uProgress)*f*1.5);gl_FragColor=vec4(c,0.8*f+0.2);}` });
    network.add(new THREE.Mesh(new THREE.IcosahedronGeometry(4, 32), somaMaterial));
    network.add(new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 16), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, wireframe: true })));
    const branchMaterial = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uIsAxon: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexShader: `${shaderNoise}
      uniform float uTime; varying vec3 vWorldPos; varying vec3 vNormal; varying vec3 vViewPosition; varying vec2 vUv;
      void main(){vUv=uv;vec3 pos=position;pos+=normal*snoise(pos*0.2+uTime*0.5)*0.1;vec4 world=modelMatrix*vec4(pos,1.0);vWorldPos=world.xyz;vNormal=normalize(normalMatrix*normal);vec4 mv=viewMatrix*world;vViewPosition=-mv.xyz;gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `${shaderNoise}
      uniform float uTime; uniform int uPhase; uniform float uProgress; uniform int uIsAxon; uniform vec3 uColCyan; uniform vec3 uColBlue; uniform vec3 uColGold; uniform vec3 uColOrange; uniform vec3 uColMagenta; uniform vec3 uColViolet; uniform float uSomaRadius; uniform float uMaxDistDendrite; uniform float uMaxDistAxon; varying vec3 vWorldPos; varying vec3 vNormal; varying vec3 vViewPosition; varying vec2 vUv;
      void main(){vec3 n=normalize(vNormal),v=normalize(vViewPosition);float edge=pow(1.0-abs(vUv.y-0.5)*2.0,2.0);float fresnel=pow(1.0-max(dot(n,v),0.0),2.0);float dist=length(vWorldPos);vec3 base=mix(uColBlue*0.1,uColCyan*0.5,fresnel*edge);float flow=snoise(vec3(vUv.x*20.0-uTime*2.0,vUv.y*10.0,uTime))*0.5+0.5;float axial=0.65+0.35*sin(vUv.x*34.0-uTime*8.0);vec3 pulse=vec3(0.0);if(uIsAxon==0&&uPhase==1){float wave=mix(uMaxDistDendrite,uSomaRadius,uProgress);float head=1.0-smoothstep(0.0,2.3,abs(dist-wave));float trail=step(wave,dist)*exp(-(dist-wave)*0.18);pulse=uColGold*max(head*1.6,trail*0.65)*flow*axial*3.2;}else if(uIsAxon==1&&uPhase==3){float wave=mix(uSomaRadius,uMaxDistAxon+18.0,uProgress);float head=1.0-smoothstep(0.0,3.4,abs(dist-wave));float trail=step(dist,wave)*exp(-(wave-dist)*0.1);pulse=(uColOrange+uColGold*0.45)*max(head*2.0,trail*0.9)*flow*axial*4.6;}if(uPhase==4)pulse+=uColViolet*(1.0-uProgress)*edge*1.5;gl_FragColor=vec4(base+pulse,1.0);}` });
    const axonMaterial = branchMaterial.clone();
    axonMaterial.uniforms.uIsAxon = { value: 1 };
    const synapsePositions: number[] = [];
    const buildBranch = (start: THREE.Vector3, direction: THREE.Vector3, length: number, radius: number, level: number, maxLevels: number, isAxon: boolean) => {
      const points = [start.clone()]; let current = start.clone(); const dir = direction.clone();
      for (let index = 0; index < 12; index += 1) { dir.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(isAxon ? 0.3 : 0.8)).normalize(); current = current.clone().add(dir.clone().multiplyScalar(length / 12)); points.push(current); }
      network.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, radius, 6, false), isAxon ? axonMaterial : branchMaterial));
      if (level < maxLevels) { const childCount = isAxon ? (Math.random() > 0.3 ? 1 : 2) : (Math.random() > 0.2 ? 2 : 3); for (let child = 0; child < childCount; child += 1) buildBranch(current, dir.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8)).normalize(), length * (0.6 + Math.random() * 0.3), radius * 0.65, level + 1, maxLevels, isAxon); }
      else synapsePositions.push(current.x, current.y, current.z);
    };
    for (let index = 0; index < 14; index += 1) { const direction = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(); if (direction.z > 0.3) direction.z -= 0.8; direction.normalize(); buildBranch(direction.clone().multiplyScalar(3.5), direction, 12 + Math.random() * 5, 0.4, 0, 2, false); }
    for (let index = 0; index < 4; index += 1) { const direction = new THREE.Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, 1).normalize(); buildBranch(direction.clone().multiplyScalar(3.5), direction, 25 + Math.random() * 10, 0.6, 0, 2, true); }
    const synapseGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(synapsePositions, 3));
    const synapses = new THREE.Points(synapseGeometry, new THREE.PointsMaterial({ color: 0x00e5ff, size: 0.24, transparent: true, opacity: 0.84, blending: THREE.AdditiveBlending, depthWrite: false }));
    network.add(synapses);
    const dustPositions = new Float32Array(800 * 3); for (let index = 0; index < dustPositions.length; index += 1) dustPositions[index] = (Math.random() - 0.5) * 150;
    const dustGeometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
    const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0x00dfff, size: 0.2, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(dust);

    const phase = { value: 0, progress: 0, active: false, lastPulse: stateRef.current.pulseNonce, elapsedSincePulse: 0 };
    const beginPulse = () => { phase.active = true; phase.value = 1; phase.progress = 0; };
    const resize = () => { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setSize(width, height, false); composer.setSize(width, height); camera.aspect = width / height; camera.fov = width < 720 ? 52 : 45; camera.updateProjectionMatrix(); activity?.request(); };
    resize(); const observer = new ResizeObserver(resize); observer.observe(host);
    const clock = new THREE.Clock();
    const render = () => {
      const delta = Math.min(clock.getDelta(), 0.04); const elapsed = clock.elapsedTime; const current = stateRef.current;
      if (reduceMotion) {
        phase.active = false;
        phase.value = 0;
        phase.progress = 0;
        phase.elapsedSincePulse = 0;
        phase.lastPulse = current.pulseNonce;
      } else {
        if (current.pulseNonce !== phase.lastPulse) { phase.lastPulse = current.pulseNonce; beginPulse(); }
        phase.elapsedSincePulse += delta;
        if (current.playing && !phase.active && phase.elapsedSincePulse > 8) { phase.elapsedSincePulse = 0; beginPulse(); }
        if (phase.active) { const speed = phase.value === 2 ? 2.5 : phase.value === 4 ? 0.5 : phase.value === 1 ? 0.8 : 0.95; phase.progress += delta * speed; if (phase.progress >= 1) { phase.progress = 0; phase.value += 1; if (phase.value === 2) camera.position.multiplyScalar(0.86); if (phase.value === 3) camera.position.multiplyScalar(1.18); if (phase.value > 4) { phase.value = 0; phase.active = false; } } }
      }
      uniforms.uTime.value = reduceMotion ? 0 : elapsed; uniforms.uPhase.value = phase.value; uniforms.uProgress.value = phase.progress;
      if (!reduceMotion) { network.rotation.y += (current.playing ? 0.028 : 0.006); network.rotation.x = Math.sin(elapsed * 0.12) * 0.025; dust.rotation.y = elapsed * 0.02; }
      controls.autoRotate = !reduceMotion; controls.update(); bloomPass.strength += ((phase.active ? 2.45 : 1.8) - bloomPass.strength) * 0.05; composer.render();
    };
    activity = createAnimationActivity(host, render, () => !reduceMotion);
    const requestControlRender = () => activity?.request();
    controls.addEventListener("change", requestControlRender);
    return () => { activity?.dispose(); observer.disconnect(); motionQuery.removeEventListener("change", onMotionChange); canvas.removeEventListener("webglcontextlost", onContextLost); controls.removeEventListener("change", requestControlRender); controls.dispose(); composer.dispose(); network.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } }); dustGeometry.dispose(); (dust.material as THREE.Material).dispose(); renderer.dispose(); };
  }, []);
  return <canvas ref={canvasRef} className="neural-cathedral-canvas" aria-hidden="true" />;
}
