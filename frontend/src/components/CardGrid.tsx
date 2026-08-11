import { memo, type CSSProperties, type ReactNode } from "react";
import { Heart, Play, Record } from "@phosphor-icons/react";
import type { createT } from "../i18n";
import { LazyCoverImage } from "./LazyCoverImage";

type CardGridItem = {
  id: number | string;
  title: string;
  subtitle: string;
  meta?: string;
  theme: string;
  coverUrl?: string;
  favorite?: boolean;
  onClick: () => void;
  onMetaClick?: () => void;
  onPlay?: () => void;
  onFavorite?: () => void;
};

type CardGridProps = {
  t: ReturnType<typeof createT>;
  title: string;
  variant?: "playlist" | "album" | "artist" | "radio";
  items: CardGridItem[];
  action?: ReactNode;
  actionKey?: string | number;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
};

function cardGridItemsEqual(a: CardGridItem[], b: CardGridItem[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.title !== right.title ||
      left.subtitle !== right.subtitle ||
      left.meta !== right.meta ||
      left.theme !== right.theme ||
      left.coverUrl !== right.coverUrl ||
      left.favorite !== right.favorite ||
      Boolean(left.onPlay) !== Boolean(right.onPlay) ||
      Boolean(left.onFavorite) !== Boolean(right.onFavorite) ||
      Boolean(left.onMetaClick) !== Boolean(right.onMetaClick)
    ) {
      return false;
    }
  }
  return true;
}

function areCardGridPropsEqual(previous: CardGridProps, next: CardGridProps) {
  return (
    previous.title === next.title &&
    previous.variant === next.variant &&
    previous.actionKey === next.actionKey &&
    previous.loading === next.loading &&
    previous.emptyTitle === next.emptyTitle &&
    previous.emptyDescription === next.emptyDescription &&
    cardGridItemsEqual(previous.items, next.items)
  );
}

export const CardGrid = memo(function CardGrid({
  t,
  title,
  items,
  action,
  loading = false,
  emptyTitle,
  emptyDescription,
  variant = "playlist",
}: CardGridProps) {
  return (
    <section
      className={`card-grid-section card-grid-${variant}`}
      data-has-action={action ? "true" : "false"}
      aria-busy={loading}
    >
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {items.length ? (
        <div className="cards">
          {items.map((item) => {
            const useLazyCoverImage = variant !== "playlist" && item.coverUrl;
            return (
              <article
                className={`media-card ${item.theme} card-${variant}`}
                key={item.id}
              >
                <div
                  className={
                    variant === "playlist" ? "cover" : "cover plain-cover"
                  }
                  style={
                    variant === "playlist" && item.coverUrl
                      ? ({
                          "--cover-url": `url(${item.coverUrl})`,
                        } as CSSProperties)
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="card-open"
                    onClick={item.onClick}
                    aria-label={item.title}
                  >
                    {useLazyCoverImage ? (
                      <LazyCoverImage src={item.coverUrl} />
                    ) : null}
                    <Record weight="fill" />
                  </button>
                  {item.onPlay ? (
                    <button
                      type="button"
                      className="card-play"
                      aria-label={t("play")}
                      onClick={(event) => {
                        event.stopPropagation();
                        item.onPlay?.();
                      }}
                    >
                      <Play weight="fill" />
                    </button>
                  ) : null}
                  {item.onFavorite ? (
                    <button
                      type="button"
                      className={
                        item.favorite ? "card-favorite active" : "card-favorite"
                      }
                      aria-label={t(item.favorite ? "removeFavorite" : "addFavorite")}
                      aria-pressed={Boolean(item.favorite)}
                      onClick={(event) => {
                        event.stopPropagation();
                        item.onFavorite?.();
                      }}
                    >
                      <Heart weight={item.favorite ? "fill" : "regular"} />
                    </button>
                  ) : null}
                </div>
                <button type="button" className="media-card-title" onClick={item.onClick}>
                  {item.title}
                </button>
                {item.meta ? (
                  <span className="card-meta">
                    {item.onMetaClick ? (
                      <button
                        type="button"
                        className="card-meta-button"
                        onClick={item.onMetaClick}
                      >
                        {item.meta}
                      </button>
                    ) : (
                      <em>{item.meta}</em>
                    )}
                    <small>{item.subtitle}</small>
                  </span>
                ) : (
                  <span>{item.subtitle}</span>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty card-grid-empty" role="status">
          {loading ? (
            <span>{t("loading")}</span>
          ) : (
            <>
              {emptyTitle ? <Heart weight="regular" aria-hidden="true" /> : null}
              <strong>{emptyTitle ?? t("emptyCollection")}</strong>
              {emptyDescription ? <span>{emptyDescription}</span> : null}
            </>
          )}
        </div>
      )}
    </section>
  );
}, areCardGridPropsEqual);
