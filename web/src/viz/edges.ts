import type { PostOut } from "../data/api";

/**
 * Link between two posts in the constellation graph.
 * `weight` = number of topics shared between the two posts (always >= minShared).
 *
 * Current edge strategy: topic overlap. Posts that share >= minShared topics are
 * connected; the number of shared topics becomes the edge weight. This surfaces
 * week-over-week story clusters ("OpenAI drama", "EU AI Act", "open-weights
 * releases") using fields the worker already emits.
 *
 * FUTURE: swap `buildTopicEdges` for an embedding-nearest-neighbor edge
 * function once the worker emits title+snippet sentence embeddings
 * (roadmap: `worker/embeddings.py` + a pgvector / FAISS index). Semantic
 * similarity gives genuinely richer clusters ("same story, different outlet")
 * but requires a non-trivial backend pipeline. The constellation layout is
 * agnostic to edge provenance -- only this module needs to change.
 */
export interface Edge {
  source: string;
  target: string;
  weight: number;
}

export interface EdgeBuildOptions {
  /** Minimum shared topics required to emit an edge. Default 2. */
  minShared?: number;
  /** Cap per-node degree to avoid hairballs on heavy topic clusters. Default 6. */
  maxDegreePerNode?: number;
}

/**
 * Build edges by topic overlap. Deterministic for a given input ordering.
 *
 * Algorithm:
 *   1. Bucket posts by topic. Each bucket is a fully-connected subgraph for
 *      that single topic.
 *   2. Count shared-topic pairs -> weight.
 *   3. Filter by weight >= minShared.
 *   4. Greedy degree cap: sort edges desc by weight; keep an edge only if
 *      both endpoints are still below maxDegreePerNode.
 *
 * Complexity: O(sum_i(|topic_i|^2)) in the aggregation step. Windows rarely
 * put more than a few hundred posts on a single topic so this is fine in
 * practice. If it ever becomes a bottleneck we can flip to a two-sided
 * adjacency map.
 */
export function buildTopicEdges(
  posts: PostOut[],
  opts: EdgeBuildOptions = {},
): Edge[] {
  const minShared = opts.minShared ?? 2;
  const maxDegree = opts.maxDegreePerNode ?? 6;

  // topic -> post ids that carry that topic
  const byTopic = new Map<string, string[]>();
  for (const p of posts) {
    const topics = p.topics ?? [];
    for (const raw of topics) {
      const t = raw.trim().toLowerCase();
      if (!t) continue;
      const bucket = byTopic.get(t);
      if (bucket) bucket.push(p.id);
      else byTopic.set(t, [p.id]);
    }
  }

  // Aggregate shared-topic counts per ordered pair (a < b lexicographically).
  const shared = new Map<string, number>(); // "a|b" -> shared count
  for (const bucket of byTopic.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i], b = bucket[j];
        if (a === b) continue;
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const k = `${lo}|${hi}`;
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
  }

  // Collect candidates meeting the weight threshold.
  const candidates: Edge[] = [];
  for (const [k, w] of shared) {
    if (w < minShared) continue;
    const [source, target] = k.split("|");
    candidates.push({ source, target, weight: w });
  }

  // Sort by weight desc so the greedy cap keeps the strongest links.
  // Tiebreaker: lexicographic to keep the result deterministic.
  candidates.sort((x, y) =>
    y.weight - x.weight || x.source.localeCompare(y.source) || x.target.localeCompare(y.target)
  );

  const degree = new Map<string, number>();
  const kept: Edge[] = [];
  for (const e of candidates) {
    const ds = degree.get(e.source) ?? 0;
    const dt = degree.get(e.target) ?? 0;
    if (ds >= maxDegree || dt >= maxDegree) continue;
    kept.push(e);
    degree.set(e.source, ds + 1);
    degree.set(e.target, dt + 1);
  }
  return kept;
}

/** Convenience: adjacency map for O(1) neighbor lookup during hover highlight. */
export function adjacency(edges: Edge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const s = adj.get(a) ?? new Set<string>();
    s.add(b);
    adj.set(a, s);
  };
  for (const e of edges) {
    add(e.source, e.target);
    add(e.target, e.source);
  }
  return adj;
}
