import { useArtworkActivity } from './useArtworkActivity';

export function DesktopPlayerBackdrop({ playing }: { playing: boolean }) {
  const { ref, visible } = useArtworkActivity();
  return <div ref={ref} className="desktop-player-backdrop" data-moving={playing && visible} aria-hidden="true"><i /><i /></div>;
}
