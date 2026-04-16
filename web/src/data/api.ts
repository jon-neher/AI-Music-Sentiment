export type Category = "public" | "business" | "science";

export interface PostOut {
  id: string;
  source: string;
  category: Category;
  title: string;
  snippet: string;
  url: string;
  author: string;
  published_at: string;
  sentiment: number;
  emotions: Record<string, number>;
  topics: string[];
  reach: number;
}

export interface AggregateOut {
  day: string;
  source: string;
  category: Category;
  mean_sentiment: number;
  variance: number;
  volume: number;
  emotions: Record<string, number>;
  exemplar_ids: string[];
}

export interface WindowResponse {
  from: string;
  to: string;
  aggregates: AggregateOut[];
  exemplars: PostOut[];
}

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "/api";

export async function fetchWindow(from: Date, to: Date, sources?: Category[]): Promise<WindowResponse> {
  const params = new URLSearchParams({
    from: from.toISOString(),
    to: to.toISOString(),
  });
  if (sources && sources.length) params.set("sources", sources.join(","));

  const r = await fetch(`${BASE}/window?${params.toString()}`);
  if (!r.ok) throw new Error(`window fetch failed: ${r.status}`);
  const data = await r.json();
  return { ...data, from: data.from_ ?? data.from } as WindowResponse;
}

export async function fetchStats(): Promise<{ total_posts: number; by_category: Record<string, number> }> {
  const r = await fetch(`${BASE}/stats`);
  if (!r.ok) throw new Error("stats failed");
  return r.json();
}
