import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const PRESETS = [
  { name: "Aethera", a: 0x54e2ff, b: 0xa058ff, body: 0x0b59a8, ring: false },
  { name: "Pyra", a: 0xff842c, b: 0xff2d56, body: 0x5d100d, ring: false },
  { name: "Orison", a: 0xffdc8e, b: 0x4ae8d2, body: 0x7b6141, ring: true },
  { name: "Vesper", a: 0xb174ff, b: 0x4ce6ff, body: 0x31127b, ring: false },
] as const;

export function CelestialTransmutationLayer({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMotionChange = (event: MediaQueryListEvent) => { reduceMotion = event.matches; };
    motionQuery.addEventListener("change", onMotionChange);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.45));
    renderer.setClearColor(0x02030a, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(39, 1, 0.08, 100);
    camera.position.set(0, 0.24, 9.2);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.enablePan = false;
    controls.enableZoom = false;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.18;
    controls.target.set(0, 0.02, 0);
    const world = new THREE.Group();
    scene.add(world);
    const ambient = new THREE.PointLight(0x54e2ff, 14, 18, 2);
    ambient.position.set(-4, 4, 5);
    scene.add(ambient);
    const key = new THREE.PointLight(0xff8855, 10, 20, 2);
    key.position.set(4, -2, 3);
    scene.add(key);

    const starCount = 2600;
    const starPositions = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index += 1) {
      const radius = THREE.MathUtils.lerp(12, 43, Math.pow(Math.random(), 0.62));
      const y = THREE.MathUtils.randFloatSpread(2);
      const angle = Math.random() * Math.PI * 2;
      const radial = Math.sqrt(Math.max(0, 1 - y * y));
      starPositions[index * 3] = Math.cos(angle) * radial * radius;
      starPositions[index * 3 + 1] = y * radius;
      starPositions[index * 3 + 2] = Math.sin(angle) * radial * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x86bfff, size: 0.065, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(stars);

    const planetGroups = PRESETS.map((preset, index) => {
      const group = new THREE.Group();
      group.visible = index === 0;
      const material = new THREE.MeshStandardMaterial({ color: preset.body, roughness: 0.78, metalness: 0.12, emissive: preset.a, emissiveIntensity: 0.18, transparent: true, opacity: index === 0 ? 1 : 0 });
      const body = new THREE.Mesh(new THREE.IcosahedronGeometry(2.06, 5), material);
      group.add(body);
      const atmosphere = new THREE.Mesh(new THREE.IcosahedronGeometry(2.18, 4), new THREE.MeshBasicMaterial({ color: preset.a, transparent: true, opacity: index === 0 ? 0.22 : 0, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false }));
      group.add(atmosphere);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.06, 5, 160), new THREE.MeshBasicMaterial({ color: preset.b, transparent: true, opacity: preset.ring && index === 0 ? 0.72 : 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      ring.rotation.x = 1.05;
      ring.rotation.z = 0.3;
      group.add(ring);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(2.42, 28, 28), new THREE.MeshBasicMaterial({ color: preset.b, transparent: true, opacity: index === 0 ? 0.05 : 0, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false }));
      group.add(glow);
      world.add(group);
      return { group, material, atmosphere: atmosphere.material as THREE.MeshBasicMaterial, ring: ring.material as THREE.MeshBasicMaterial, ringMesh: ring, glow: glow.material as THREE.MeshBasicMaterial };
    });

    let current = 0;
    let target = 0;
    let transition = 1;
    let transitionStarted = 0;
    let lastAutoCycle = 0;
    const chooseNext = (time: number) => {
      if (transition < 1) return;
      target = (current + 1) % PRESETS.length;
      transition = 0;
      transitionStarted = time;
      planetGroups[target].group.visible = true;
    };
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.position.z = width < 600 ? 10.7 : 9.2;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const clock = new THREE.Clock();
    let frame = 0;
    const render = () => {
      const time = clock.getElapsedTime();
      const active = playingRef.current;
      if (active && !reduceMotion && time - lastAutoCycle > 11) { lastAutoCycle = time; chooseNext(time); }
      if (!reduceMotion) {
        world.rotation.y += (active ? 0.035 : 0.007);
        world.rotation.x = Math.sin(time * 0.12) * 0.025;
        stars.rotation.y = time * 0.0016;
        planetGroups.forEach((planet, index) => { planet.ringMesh.rotation.z = time * 0.12 + index * 0.3; });
      }
      if (transition < 1) {
        transition = reduceMotion ? 1 : Math.min(1, (time - transitionStarted) / 1.28);
        const eased = transition * transition * (3 - 2 * transition);
        const from = planetGroups[current];
        const to = planetGroups[target];
        from.material.opacity = 1 - eased;
        from.atmosphere.opacity = 0.22 * (1 - eased);
        from.glow.opacity = 0.05 * (1 - eased);
        to.material.opacity = eased;
        to.atmosphere.opacity = 0.22 * eased;
        to.glow.opacity = 0.05 * eased;
        from.group.scale.setScalar(1 - eased * 0.08);
        to.group.scale.setScalar(0.92 + eased * 0.08);
        from.ring.opacity = PRESETS[current].ring ? 0.72 * (1 - eased) : 0;
        to.ring.opacity = PRESETS[target].ring ? 0.72 * eased : 0;
        if (transition >= 1) { planetGroups[current].group.visible = false; current = target; }
      }
      controls.autoRotate = !reduceMotion;
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motionQuery.removeEventListener("change", onMotionChange);
      controls.dispose();
      starGeometry.dispose(); (stars.material as THREE.Material).dispose();
      planetGroups.forEach((planet) => { planet.group.children.forEach((child) => { if (child instanceof THREE.Mesh) { child.geometry.dispose(); (child.material as THREE.Material).dispose(); } }); });
      renderer.dispose();
    };
  }, []);
  return <canvas ref={canvasRef} className="mineradio-celestial-layer" aria-hidden="true" />;
}
