type MetadataTargetType = "song" | "album";
type MetadataCandidateScope = "path" | "online";

const values = new Map<string, unknown[]>();
const requests = new Map<string, Promise<unknown[]>>();
const generations = new Map<string, number>();

export function getCandidateCache<T>(key: string): T[] | undefined {
  return values.get(key) as T[] | undefined;
}

export function loadCandidateCache<T>(key: string, loader: () => Promise<T[]>): Promise<T[]> {
  if (values.has(key)) return Promise.resolve(values.get(key) as T[]);
  const existing = requests.get(key);
  if (existing) return existing as Promise<T[]>;

  const generation = generations.get(key) || 0;
  const request = loader()
    .then((items) => {
      if ((generations.get(key) || 0) === generation) values.set(key, items);
      return items;
    })
    .finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
  requests.set(key, request);
  return request;
}

export function invalidateCandidateCache(...keys: string[]) {
  for (const key of keys) {
    values.delete(key);
    requests.delete(key);
    generations.set(key, (generations.get(key) || 0) + 1);
  }
}

export function metadataCandidateCacheKey(
  type: MetadataTargetType,
  id: number,
  scope: MetadataCandidateScope,
) {
  return `metadata:${type}:${id}:${scope}`;
}

export function lyricCandidateCacheKey(songID: number) {
  return `lyrics:${songID}`;
}

export function invalidateMetadataCandidateCache(type: MetadataTargetType, id: number) {
  invalidateCandidateCache(
    metadataCandidateCacheKey(type, id, "path"),
    metadataCandidateCacheKey(type, id, "online"),
  );
}

export function invalidateLyricCandidateCache(songIDs: number[]) {
  invalidateCandidateCache(...songIDs.map(lyricCandidateCacheKey));
}
