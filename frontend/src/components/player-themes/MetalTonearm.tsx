/** A stationary bearing and counterweight frame a thin polished tube. */
export function MetalTonearm({ className }: { className: string }) {
  return (
    <span className={`${className} metal-tonearm`} aria-hidden="true">
      <span className="metal-bearing"><span /></span>
      <span className="metal-tube" />
      <span className="metal-counterweight" />
      <span className="metal-yoke"><span /></span>
      <span className="metal-headshell"><span /><span /><span className="metal-cartridge" /></span>
      <span className="metal-fingerlift" />
    </span>
  );
}
