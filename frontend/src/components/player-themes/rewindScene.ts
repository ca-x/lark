import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createAnimationActivity } from "./animationActivity";
import { loadTapeImage, paintTape, TAPE_MATERIALS, type TapePrint } from "./rewindTexture";

export type TapeSceneState = { playing: boolean; progress: number; flipped: boolean; tiltX: number; tiltY: number };
export type TapeScene = { update: (state: TapeSceneState) => void; record: (record: TapePrint, key: string) => void; dispose: () => void };

function outline(width: number, height: number, radius: number) {
  const shape = new THREE.Shape();
  const left = -width / 2;
  const bottom = -height / 2;
  shape.moveTo(left + radius, bottom);
  shape.lineTo(left + width - radius, bottom);
  shape.quadraticCurveTo(left + width, bottom, left + width, bottom + radius);
  shape.lineTo(left + width, bottom + height - radius);
  shape.quadraticCurveTo(left + width, bottom + height, left + width - radius, bottom + height);
  shape.lineTo(left + radius, bottom + height);
  shape.quadraticCurveTo(left, bottom + height, left, bottom + height - radius);
  shape.lineTo(left, bottom + radius);
  shape.quadraticCurveTo(left, bottom, left + radius, bottom);
  return shape;
}

function circleHole(shape: THREE.Shape, horizontal: number, vertical: number, radius: number) {
  const hole = new THREE.Path();
  hole.absarc(horizontal, vertical, radius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
}

export function createTapeScene(canvas: HTMLCanvasElement, initialRecord: TapePrint, initialState: TapeSceneState): TapeScene | null {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .9;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, .1, 100);
  camera.position.set(0, 0, 14.5);
  const environment = new RoomEnvironment();
  const generator = new THREE.PMREMGenerator(renderer);
  const environmentMap = generator.fromScene(environment, .04);
  scene.environment = environmentMap.texture;
  scene.environmentIntensity = .3;
  environment.dispose(); generator.dispose();
  scene.add(new THREE.HemisphereLight(0xf3f4ec, 0x242a26, .65));
  const key = new THREE.DirectionalLight(0xfff1dc, 1.9); key.position.set(-3, 6, 9); scene.add(key);
  const rim = new THREE.DirectionalLight(0xa7d7ec, .6); rim.position.set(6, 1, 3); scene.add(rim);
  const tape = new THREE.Group(); scene.add(tape);
  const palette = TAPE_MATERIALS[initialRecord.variant];
  const shellMaterial = new THREE.MeshPhysicalMaterial({ color: palette.shell, roughness: .42, metalness: .08, clearcoat: .28, clearcoatRoughness: .4, transparent: initialRecord.variant === "rewind-crystal", opacity: initialRecord.variant === "rewind-crystal" ? .78 : 1, side: THREE.DoubleSide });
  const edgeMaterial = new THREE.MeshStandardMaterial({ color: palette.edge, roughness: .48, metalness: .15 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb3b6a7, metalness: .82, roughness: .27 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x0a100d });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xe8eadb, roughness: .45, metalness: .08 });
  const tapeMaterial = new THREE.MeshStandardMaterial({ color: 0x342921, roughness: .43, metalness: .12 });
  const shellShape = outline(9.9, 6.3, .16);
  for (const horizontal of [-2.18, 2.18]) circleHole(shellShape, horizontal, 0, .65);
  const windowHole = new THREE.Path(); windowHole.moveTo(-1.06, -.53); windowHole.lineTo(-1.06, .53); windowHole.lineTo(1.06, .53); windowHole.lineTo(1.06, -.53); windowHole.closePath(); shellShape.holes.push(windowHole);
  for (const horizontal of [-1.87, -.95, .95, 1.87]) circleHole(shellShape, horizontal, -2.54, .095);
  const shell = new THREE.Mesh(new THREE.ExtrudeGeometry(shellShape, { depth: .62, bevelEnabled: true, bevelSize: .055, bevelThickness: .055, bevelSegments: 3, steps: 1, curveSegments: 20 }), shellMaterial);
  shell.position.z = -.31; tape.add(shell);
  const seam = new THREE.Mesh(new THREE.ExtrudeGeometry(shellShape, { depth: .02, bevelEnabled: false, curveSegments: 20 }), edgeMaterial); seam.position.z = -.01; tape.add(seam);
  const frontCanvas = document.createElement("canvas");
  const backCanvas = document.createElement("canvas");
  paintTape(frontCanvas, initialRecord); paintTape(backCanvas, initialRecord, undefined, false, "B");
  const frontTexture = new THREE.CanvasTexture(frontCanvas); frontTexture.colorSpace = THREE.SRGBColorSpace;
  const backTexture = new THREE.CanvasTexture(backCanvas); backTexture.colorSpace = THREE.SRGBColorSpace;
  for (const [side, texture] of [[1, frontTexture], [-1, backTexture]] as const) {
    const label = new THREE.Mesh(new THREE.PlaneGeometry(10, 6.4), new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: .1, toneMapped: false }));
    label.position.z = side * .375; label.rotation.y = side === -1 ? Math.PI : 0; tape.add(label);
    for (const horizontal of [-2.18, 2.18]) {
      const lip = new THREE.Mesh(new THREE.TorusGeometry(.65, .026, 8, 56), shellMaterial); lip.position.set(horizontal, 0, side * .37); tape.add(lip);
    }
    const guide = new THREE.Shape(); guide.moveTo(-2.55, -3.13); guide.lineTo(-2.28, -2.02); guide.lineTo(2.28, -2.02); guide.lineTo(2.55, -3.13); guide.closePath();
    for (const horizontal of [-1.87, -.95, .95, 1.87]) circleHole(guide, horizontal, -2.54, .095);
    const guideMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(guide, { depth: .035, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 1 }), shellMaterial);
    guideMesh.position.z = side * .38; guideMesh.rotation.y = side === -1 ? Math.PI : 0; tape.add(guideMesh);
    for (const [horizontal, vertical] of [[-4.48, 2.77], [4.48, 2.77], [-4.48, -2.77], [4.48, -2.77], [0, -1.99]]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(.072, .072, .035, 16), metal); screw.rotation.x = Math.PI / 2; screw.position.set(horizontal, vertical, side * .39); tape.add(screw);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(.095, .016, .009), dark); slot.position.set(horizontal, vertical, side * .412); slot.rotation.z = horizontal > 0 ? .5 : -.3; tape.add(slot);
    }
  }
  const packs: THREE.Mesh[] = [];
  const hubs: THREE.Group[] = [];
  for (const horizontal of [-2.18, 2.18]) {
    const pack = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.46, .44, 64), tapeMaterial); pack.rotation.x = Math.PI / 2; pack.position.x = horizontal; tape.add(pack); packs.push(pack);
    const hub = new THREE.Group(); hub.position.x = horizontal; tape.add(hub); hubs.push(hub);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(.49, .074, 10, 48), ivory); hub.add(ring);
    const bore = new THREE.Mesh(new THREE.CylinderGeometry(.43, .43, .62, 36), dark); bore.rotation.x = Math.PI / 2; hub.add(bore);
    for (const side of [-1, 1]) {
      const ringFace = new THREE.Mesh(new THREE.TorusGeometry(.49, .035, 6, 40), ivory); ringFace.position.z = side * .34; hub.add(ringFace);
      for (let tooth = 0; tooth < 6; tooth++) {
        const angle = tooth * Math.PI / 3;
        const peg = new THREE.Mesh(new THREE.BoxGeometry(.095, .12, .07), ivory); peg.position.set(Math.sin(angle) * .4, Math.cos(angle) * .4, side * .35); peg.rotation.z = -angle; hub.add(peg);
      }
    }
  }
  const band = new THREE.Mesh(new THREE.BoxGeometry(4.36, .025, .4), tapeMaterial); band.position.y = -1.36; tape.add(band);
  const windowPane = new THREE.Mesh(new THREE.PlaneGeometry(2.12, 1.06), new THREE.MeshPhysicalMaterial({ color: 0x718379, transparent: true, opacity: .22, roughness: .18, metalness: .15 })); windowPane.position.z = .28; tape.add(windowPane);
  const windowBack = windowPane.clone(); windowBack.position.z = -.28; windowBack.rotation.y = Math.PI; tape.add(windowBack);
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) resources.add(material);
  });
  resources.add(frontTexture); resources.add(backTexture);
  let state = initialState;
  let disposed = false;
  let settle = 1;
  let previousTime = 0;
  let recordKey = "";
  let loadGeneration = 0;
  let cancelImage = () => {};
  let swapping = 0;
  let swapStarted = 0;
  let pending: TapePrint | null = null;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyRecord = (record: TapePrint) => {
    cancelImage();
    const generation = ++loadGeneration;
    const paint = (image?: HTMLImageElement) => {
      if (disposed || generation !== loadGeneration) return;
      paintTape(frontCanvas, record, image); paintTape(backCanvas, record, image, false, "B");
      frontTexture.needsUpdate = true; backTexture.needsUpdate = true; activity.request();
    };
    paint();
    if (record.cover) cancelImage = loadTapeImage(record.cover, paint);
  };
  const render = (now: number) => {
    const delta = previousTime ? Math.min((now - previousTime) / 1000, .04) : .016;
    previousTime = now;
    if (swapping) {
      if (!swapStarted) swapStarted = now;
      const elapsed = now - swapStarted;
      if (swapping === 1 && elapsed >= 150) { if (pending) applyRecord(pending); pending = null; swapping = 2; swapStarted = now; }
      if (swapping === 2 && elapsed >= 280) { swapping = 0; swapStarted = 0; }
    }
    const phase = swapping === 1 ? Math.min((now - swapStarted) / 150, 1) : swapping === 2 ? 1 - Math.min((now - swapStarted) / 280, 1) : 0;
    const targetX = reduce.matches ? 0 : -.1 + state.tiltX * Math.PI / 180 + phase * .9;
    const targetY = (state.flipped ? Math.PI : 0) + (reduce.matches ? 0 : state.tiltY * Math.PI / 180 - .06);
    const blend = reduce.matches ? 1 : 1 - Math.exp(-delta * 17);
    tape.rotation.x += (targetX - tape.rotation.x) * blend;
    tape.rotation.y += (targetY - tape.rotation.y) * blend;
    tape.position.y = reduce.matches ? 0 : -phase * 7;
    tape.scale.setScalar(1 - phase * .13);
    settle = Math.abs(targetX - tape.rotation.x) + Math.abs(targetY - tape.rotation.y);
    const progress = Math.max(0, Math.min(1, state.progress));
    packs[0].scale.set(1 - progress * .35, 1, 1 - progress * .35);
    packs[1].scale.set(.65 + progress * .35, 1, .65 + progress * .35);
    if (state.playing) {
      hubs[0].rotation.z -= delta * (reduce.matches ? .35 : 2.1) / (1 - progress * .35);
      hubs[1].rotation.z -= delta * (reduce.matches ? .35 : 2.1) / (.65 + progress * .35);
    }
    canvas.dataset.rotating = state.playing ? "true" : "false";
    canvas.dataset.angle = tape.rotation.y.toFixed(3);
    canvas.dataset.loading = swapping ? "true" : "false";
    canvas.dataset.reelAngle = hubs[0].rotation.z.toFixed(3);
    renderer.render(scene, camera);
  };
  const activity = createAnimationActivity(canvas, render, () => state.playing || settle > .001 || swapping !== 0);
  const resize = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    renderer.setSize(width, height, false); camera.aspect = width / height;
    camera.position.z = Math.max(14.5, 5.7 / (Math.tan(Math.PI / 12) * camera.aspect));
    camera.updateProjectionMatrix(); activity.request();
  });
  resize.observe(canvas);
  const motionChange = () => { if (reduce.matches) { if (pending) applyRecord(pending); pending = null; swapping = 0; swapStarted = 0; } activity.request(); };
  reduce.addEventListener("change", motionChange);
  applyRecord(initialRecord);
  return {
    update(next) { state = next; activity.request(); },
    record(record, key) {
      if (key === recordKey) return;
      if (!recordKey || reduce.matches) applyRecord(record);
      else { pending = record; swapping = 1; swapStarted = 0; }
      recordKey = key; activity.request();
    },
    dispose() {
      if (disposed) return;
      disposed = true; loadGeneration++; cancelImage(); activity.dispose(); resize.disconnect(); reduce.removeEventListener("change", motionChange);
      for (const resource of resources) resource.dispose(); environmentMap.dispose(); renderer.dispose(); renderer.forceContextLoss();
    },
  };
}
