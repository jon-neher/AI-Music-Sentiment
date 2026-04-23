import { describe, expect, it } from "vitest";
import type { PostOut } from "../data/api";
import { adjacency, buildTopicEdges } from "./edges";

function post(id: string, topics: string[]): PostOut {
  return {
    id,
    source: "gdelt",
    category: "business",
    title: id,
    snippet: "",
    url: "",
    author: "",
    published_at: new Date("2025-06-01T00:00:00Z").toISOString(),
    sentiment: 0,
    emotions: {},
    topics,
    reach: 1,
  };
}

describe("buildTopicEdges", () => {
  it("returns no edges for posts with <2 shared topics by default", () => {
    const edges = buildTopicEdges([
      post("a", ["ai", "regulation"]),
      post("b", ["ai", "open source"]),
    ]);
    // Only 1 shared topic ("ai") -> below minShared=2 default.
    expect(edges).toEqual([]);
  });

  it("connects posts that share >= minShared topics, with weight = shared count", () => {
    const edges = buildTopicEdges([
      post("a", ["ai", "regulation", "europe"]),
      post("b", ["ai", "regulation", "europe"]),
      post("c", ["music"]),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe("a");
    expect(edges[0].target).toBe("b");
    expect(edges[0].weight).toBe(3);
  });

  it("ignores topic case and surrounding whitespace", () => {
    const edges = buildTopicEdges([
      post("a", ["AI", " Regulation "]),
      post("b", ["ai", "regulation"]),
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(2);
  });

  it("respects custom minShared", () => {
    const edges = buildTopicEdges(
      [post("a", ["ai"]), post("b", ["ai"])],
      { minShared: 1 },
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBe(1);
  });

  it("enforces maxDegreePerNode globally", () => {
    const hub = post("hub", ["t1", "t2", "t3", "t4"]);
    const a = post("a", ["t1", "t2", "t3"]);
    const b = post("b", ["t1", "t2", "t3"]);
    const c = post("c", ["t1", "t2", "t3"]);
    const d = post("d", ["t1", "t2"]);
    const edges = buildTopicEdges([hub, a, b, c, d], { maxDegreePerNode: 2 });

    const deg = new Map<string, number>();
    for (const e of edges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    for (const v of deg.values()) expect(v).toBeLessThanOrEqual(2);
  });

  it("greedy keeps the heaviest candidate when competing for a node's single slot", () => {
    // With cap 1, "a" has exactly one outgoing edge; the heavier candidate wins.
    const a = post("a", ["t1", "t2", "t3"]);
    const heavy = post("heavy", ["t1", "t2", "t3"]); // weight 3 with a
    const light = post("light", ["t1", "t2"]);       // weight 2 with a
    const edges = buildTopicEdges([a, heavy, light], { maxDegreePerNode: 1 });

    const edgeOfA = edges.find(e => e.source === "a" || e.target === "a");
    expect(edgeOfA).toBeDefined();
    expect(edgeOfA!.weight).toBe(3);
    const other = edgeOfA!.source === "a" ? edgeOfA!.target : edgeOfA!.source;
    expect(other).toBe("heavy");
  });

  it("is deterministic for a given input ordering", () => {
    const input = [
      post("z", ["ai", "europe", "regulation"]),
      post("y", ["ai", "europe", "regulation"]),
      post("x", ["ai", "europe", "regulation"]),
    ];
    const a = buildTopicEdges(input);
    const b = buildTopicEdges(input);
    expect(a).toEqual(b);
  });

  it("tolerates posts with no topics", () => {
    const edges = buildTopicEdges([
      post("a", []),
      post("b", []),
      post("c", ["ai", "europe"]),
    ]);
    expect(edges).toEqual([]);
  });
});

describe("adjacency", () => {
  it("returns symmetric neighbor sets", () => {
    const adj = adjacency([
      { source: "a", target: "b", weight: 1 },
      { source: "a", target: "c", weight: 1 },
    ]);
    expect(adj.get("a")).toEqual(new Set(["b", "c"]));
    expect(adj.get("b")).toEqual(new Set(["a"]));
    expect(adj.get("c")).toEqual(new Set(["a"]));
  });

  it("handles empty input", () => {
    expect(adjacency([])).toEqual(new Map());
  });
});
