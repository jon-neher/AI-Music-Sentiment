import * as d3 from "d3";
import type { PostOut, Category } from "../data/api";
import { adjacency, buildTopicEdges } from "./edges";

/**
 * Layout modes:
 *  - scatter : deterministic (time, sentiment) scatter. No forces, no edges.
 *  - cluster : "magnetized scatter" -- d3-force with strong X/Y anchors toward
 *              the scatter position, plus topic-overlap link forces so related
 *              stories pool together. This is the hybrid Obsidian-ish view.
 *  - graph   : pure Obsidian -- no positional anchor to time or sentiment.
 *              Layout emerges from topology; sentiment/time live in scrubber,
 *              drawer, and tooltip only.
 */
export type VizMode = "scatter" | "cluster" | "graph";

export const VIZ_MODES: VizMode[] = ["scatter", "cluster", "graph"];

const COLORS: Record<Category, string> = {
  public: "var(--public)",
  business: "var(--business)",
  science: "var(--science)",
};

function shapePath(cat: Category, size: number): string {
  const s = size;
  if (cat === "public") {
    return `M 0,0 m -${s},0 a ${s},${s} 0 1,0 ${s * 2},0 a ${s},${s} 0 1,0 -${s * 2},0`;
  }
  if (cat === "business") {
    return `M ${-s},${-s} h ${s * 2} v ${s * 2} h ${-s * 2} Z`;
  }
  return `M 0,${-s} L ${s},${s} L ${-s},${s} Z`;
}

function formatReach(n: number): string {
  if (!n || n < 1) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function formatSent(s: number): string {
  const sign = s >= 0 ? "+" : "";
  return `${sign}${s.toFixed(2)}`;
}

const DATE_LABEL = d3.timeFormat("%b %-d");

function titleText(d: PostOut): string {
  return `${d.title}  [${d.source}]  ·  sent ${formatSent(d.sentiment)}  ·  reach ${formatReach(d.reach)}`;
}

/** Mutable node object for d3-force. `anchorX`/`anchorY` drive the X/Y forces
 * in cluster mode. Starting position seeds the simulation near the anchor so
 * convergence is fast and visually stable. */
interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  post: PostOut;
  anchorX: number;
  anchorY: number;
  r: number;
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  weight: number;
}

export class Constellation {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

  // z-order: margins (bottom) -> edges -> dots -> ghost-axes (top)
  private marginsLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private edgesLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private dotsLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private axesLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;

  private lastPosts: PostOut[] = [];
  private lastPostIds = "";
  private axesOn = false;
  private mode: VizMode = "cluster";
  private ro?: ResizeObserver;

  // Force-simulation state
  private sim?: d3.Simulation<SimNode, SimEdge>;
  private simNodes: SimNode[] = [];
  private simEdges: SimEdge[] = [];
  private adj: Map<string, Set<string>> = new Map();

  constructor(container: HTMLElement) {
    this.container = container;
    const existing = container.querySelector<SVGSVGElement>(":scope > svg.constellation");
    const node = existing ?? d3.select(container).append("svg")
      .attr("class", "constellation")
      .attr("role", "img")
      .attr("aria-label", "Constellation of AI-sentiment posts")
      .node()!;
    this.svg = d3.select(node);

    this.marginsLayer = this.ensureLayer("margins");
    this.edgesLayer = this.ensureLayer("edges");
    this.dotsLayer = this.ensureLayer("dots");
    this.axesLayer = this.ensureLayer("ghost-axes");
    this.axesLayer.attr("display", this.axesOn ? null : "none");

    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        if (this.lastPosts.length) this.render(this.lastPosts);
      });
      this.ro.observe(container);
    }
    window.addEventListener("resize", () => {
      if (this.lastPosts.length) this.render(this.lastPosts);
    }, { passive: true });
  }

  /** Toggle explicit tick-labeled axes. Only meaningful in scatter + cluster. */
  setAxes(on: boolean): void {
    this.axesOn = on;
    this.axesLayer.attr("display", on ? null : "none");
    if (this.lastPosts.length) this.render(this.lastPosts);
  }

  getAxes(): boolean {
    return this.axesOn;
  }

  /** Switch layout mode. Triggers a simulation restart if posts are present. */
  setMode(m: VizMode): void {
    if (m === this.mode) return;
    this.mode = m;
    document.body.dataset.vizMode = m;
    if (this.lastPosts.length) this.render(this.lastPosts, { force: true });
  }

  getMode(): VizMode {
    return this.mode;
  }

  private ensureLayer(cls: string): d3.Selection<SVGGElement, unknown, null, undefined> {
    const existing = this.svg.select<SVGGElement>(`:scope > g.${cls}`);
    if (!existing.empty()) return existing;
    return this.svg.append("g").attr("class", cls);
  }

  private measure(): { width: number; height: number } {
    const svgNode = this.svg.node()!;
    let { width, height } = svgNode.getBoundingClientRect();
    if (width < 2 || height < 2) {
      const pr = this.container.getBoundingClientRect();
      if (width < 2) width = pr.width;
      if (height < 2) height = pr.height;
    }
    if (width < 2) width = window.innerWidth;
    if (height < 2) height = Math.max(320, Math.round(window.innerHeight * 0.6));
    return { width, height };
  }

  render(posts: PostOut[], opts: { force?: boolean } = {}): void {
    this.lastPosts = posts;
    const { width, height } = this.measure();

    if (width < 2 || height < 2) {
      requestAnimationFrame(() => this.render(posts, opts));
      return;
    }

    if (posts.length === 0) {
      this.stopSim();
      this.dotsLayer.selectAll("*").remove();
      this.edgesLayer.selectAll("*").remove();
      this.marginsLayer.selectAll("*").remove();
      this.axesLayer.selectAll("*").remove();
      this.lastPostIds = "";
      return;
    }

    const tExtent = d3.extent(posts, p => new Date(p.published_at)) as [Date, Date];
    const tDomain: [Date, Date] = tExtent[0] && tExtent[1] && +tExtent[0] !== +tExtent[1]
      ? tExtent
      : [new Date(Date.now() - 86400_000), new Date()];
    const x = d3.scaleTime().domain(tDomain).range([40, Math.max(60, width - 40)]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 40, 40]);
    const r = d3.scaleSqrt().domain([0, d3.max(posts, p => p.reach) || 1]).range([3, 10]);

    // --- Marginalia (mode-aware) -----------------------------------------
    this.renderMargins(width, height, y, tDomain);

    // --- Ghost axes (scatter + cluster only, opt-in) ---------------------
    if (this.axesOn && this.mode !== "graph") {
      this.renderGhostAxes(width, height, x, y);
    } else {
      this.axesLayer.selectAll("*").remove();
    }

    // --- Simulation nodes/edges ------------------------------------------
    const idsKey = posts.map(p => p.id).sort().join("|");
    const postsChanged = idsKey !== this.lastPostIds;
    if (postsChanged || opts.force || !this.sim) {
      this.rebuildSim(posts, x, y, r, width, height);
      this.lastPostIds = idsKey;
    } else {
      // Same posts, measurements may have changed; refresh anchors + radii.
      for (const n of this.simNodes) {
        n.anchorX = x(new Date(n.post.published_at));
        n.anchorY = y(n.post.sentiment);
        n.r = r(n.post.reach || 0);
      }
      this.applyForcesForMode(width, height);
    }

    // --- Dots (data-join against simNodes so indices stay stable) --------
    const sel = this.dotsLayer.selectAll<SVGPathElement, SimNode>("path.dot")
      .data(this.simNodes, (d: any) => d.id);

    sel.exit().transition().duration(500).attr("opacity", 0).remove();

    const enter = sel.enter().append("path")
      .attr("class", "dot")
      .attr("data-cat", d => d.post.category)
      .attr("data-id", d => d.id)
      .attr("transform", d => `translate(${d.x ?? d.anchorX},${d.y ?? d.anchorY})`)
      .attr("d", d => shapePath(d.post.category, d.r))
      .attr("fill", d => COLORS[d.post.category])
      .attr("fill-opacity", 0.0)
      .attr("stroke", "var(--ink)")
      .attr("stroke-width", 0.6)
      .style("cursor", "pointer")
      .on("click", (_, d) => window.open(d.post.url, "_blank", "noopener"))
      .on("pointerenter", (_, d) => this.highlightNeighbors(d.id))
      .on("pointerleave", () => this.clearHighlight());

    enter.append("title").text(d => titleText(d.post));

    enter.transition().duration(700).attr("fill-opacity", 0.75);

    sel.attr("d", d => shapePath(d.post.category, d.r))
      .select<SVGTitleElement>("title").text(d => titleText(d.post));

    // In scatter mode, snap transforms directly (no simulation is running).
    if (this.mode === "scatter") {
      this.dotsLayer.selectAll<SVGPathElement, SimNode>("path.dot").transition().duration(600)
        .attr("transform", d => `translate(${x(new Date(d.post.published_at))},${y(d.post.sentiment)})`);
      this.edgesLayer.selectAll("*").remove();
    }
  }

  // --------------------------------------------------------------------- //
  // Simulation                                                             //
  // --------------------------------------------------------------------- //

  private rebuildSim(
    posts: PostOut[],
    x: d3.ScaleTime<number, number>,
    y: d3.ScaleLinear<number, number>,
    r: (n: number) => number,
    width: number,
    height: number,
  ): void {
    this.stopSim();

    // Build edges every time (cheap, deterministic for a given post-set).
    const rawEdges = buildTopicEdges(posts);
    this.adj = adjacency(rawEdges);

    this.simNodes = posts.map(p => {
      const ax = x(new Date(p.published_at));
      const ay = y(p.sentiment);
      return {
        id: p.id,
        post: p,
        anchorX: ax,
        anchorY: ay,
        r: r(p.reach || 0),
        x: ax,
        y: ay,
      };
    });

    const idx = new Map(this.simNodes.map(n => [n.id, n]));
    this.simEdges = rawEdges
      .map(e => ({
        source: idx.get(e.source)!,
        target: idx.get(e.target)!,
        weight: e.weight,
      }))
      .filter(e => e.source && e.target) as SimEdge[];

    // Render edges once here; they get position updates in tick() below.
    if (this.mode !== "scatter") {
      const edgeSel = this.edgesLayer.selectAll<SVGLineElement, SimEdge>("line.edge")
        .data(this.simEdges, (d: any) => `${(d.source as SimNode).id}|${(d.target as SimNode).id}`);
      edgeSel.exit().remove();
      edgeSel.enter().append("line")
        .attr("class", "edge")
        .attr("stroke", "var(--ink)")
        .attr("stroke-opacity", 0.08)
        .attr("stroke-linecap", "round")
        .merge(edgeSel as any)
        .attr("stroke-width", (d: any) => 0.4 + Math.min(1.2, 0.3 * d.weight));
    } else {
      this.edgesLayer.selectAll("*").remove();
    }

    this.sim = d3.forceSimulation<SimNode, SimEdge>(this.simNodes)
      .alpha(0.7)
      .alphaDecay(0.04)
      .velocityDecay(0.35)
      .on("tick", () => this.onTick(width, height));

    this.sim.force("link", d3.forceLink<SimNode, SimEdge>(this.simEdges)
      .id(d => d.id)
      .distance(e => 28 + 4 * (3 - Math.min(3, e.weight)))
      .strength(0.35));
    this.sim.force("collide", d3.forceCollide<SimNode>(n => n.r + 2).iterations(2));
    this.sim.force("charge", d3.forceManyBody<SimNode>().strength(-8).distanceMax(120));

    this.applyForcesForMode(width, height);
  }

  /** Toggle X/Y anchor forces to reflect the current mode. Called both from
   * rebuildSim and on a mode change without new posts. */
  private applyForcesForMode(width: number, height: number): void {
    if (!this.sim) return;

    if (this.mode === "scatter") {
      // Scatter is deterministic; stop the simulation and let render() place
      // each dot directly via its anchor. Removing the forces prevents any
      // stray alpha ticks from drifting positions.
      this.sim.force("x", null);
      this.sim.force("y", null);
      this.sim.force("center", null);
      this.sim.alpha(0).stop();
      return;
    }

    if (this.mode === "cluster") {
      // Strong X/Y anchors so each dot sits *near* its scatter position but
      // relaxes into local clumps under link attraction.
      this.sim.force("x", d3.forceX<SimNode>(n => n.anchorX).strength(0.55));
      this.sim.force("y", d3.forceY<SimNode>(n => n.anchorY).strength(0.55));
      this.sim.force("center", null);
    } else {
      // Graph: no positional anchor. Gentle gravity toward canvas center.
      this.sim.force("x", null);
      this.sim.force("y", null);
      this.sim.force("center", d3.forceCenter(width / 2, height / 2).strength(0.03));
    }

    this.sim.alpha(0.55).restart();
  }

  private onTick(_width: number, _height: number): void {
    this.dotsLayer.selectAll<SVGPathElement, SimNode>("path.dot")
      .attr("transform", d => `translate(${d.x ?? d.anchorX},${d.y ?? d.anchorY})`);
    this.edgesLayer.selectAll<SVGLineElement, SimEdge>("line.edge")
      .attr("x1", d => (d.source as SimNode).x ?? 0)
      .attr("y1", d => (d.source as SimNode).y ?? 0)
      .attr("x2", d => (d.target as SimNode).x ?? 0)
      .attr("y2", d => (d.target as SimNode).y ?? 0);
  }

  private stopSim(): void {
    if (this.sim) {
      this.sim.stop();
      this.sim.on("tick", null);
      this.sim = undefined;
    }
  }

  // --------------------------------------------------------------------- //
  // Hover highlight                                                        //
  // --------------------------------------------------------------------- //

  private highlightNeighbors(id: string): void {
    if (this.mode === "scatter") return; // no edges to emphasize
    const neighbors = this.adj.get(id) ?? new Set<string>();
    this.dotsLayer.selectAll<SVGPathElement, SimNode>("path.dot")
      .attr("fill-opacity", d => d.id === id || neighbors.has(d.id) ? 0.9 : 0.15);
    this.edgesLayer.selectAll<SVGLineElement, SimEdge>("line.edge")
      .attr("stroke-opacity", d => {
        const s = (d.source as SimNode).id;
        const t = (d.target as SimNode).id;
        return (s === id || t === id) ? 0.35 : 0.03;
      });
  }

  private clearHighlight(): void {
    this.dotsLayer.selectAll<SVGPathElement, SimNode>("path.dot")
      .attr("fill-opacity", 0.75);
    this.edgesLayer.selectAll<SVGLineElement, SimEdge>("line.edge")
      .attr("stroke-opacity", 0.08);
  }

  // --------------------------------------------------------------------- //
  // Marginalia + ghost axes                                                //
  // --------------------------------------------------------------------- //

  private renderMargins(
    width: number,
    height: number,
    y: d3.ScaleLinear<number, number>,
    tDomain: [Date, Date],
  ): void {
    this.marginsLayer.selectAll("*").remove();
    if (this.mode === "graph") {
      // In graph mode hopeful/fearful and the neutral line would lie -- the
      // vertical axis no longer encodes sentiment. Show a minimal caption
      // instead, explaining what the viewer is looking at.
      this.marginsLayer.append("text")
        .attr("class", "axis-annot mode-caption")
        .attr("x", width / 2)
        .attr("y", 24)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--ink-soft)")
        .attr("fill-opacity", 0.6)
        .attr("font-family", "var(--font-hand)")
        .attr("font-size", 15)
        .attr("font-style", "italic")
        .text("graph view — linked by shared topics");
      return;
    }

    const y0 = y(0);
    this.marginsLayer.append("line")
      .attr("class", "neutral-line")
      .attr("x1", 40).attr("x2", Math.max(60, width - 40))
      .attr("y1", y0).attr("y2", y0)
      .attr("stroke", "var(--ink)")
      .attr("stroke-opacity", 0.12)
      .attr("stroke-dasharray", "2 4")
      .attr("stroke-width", 1);
    this.marginsLayer.append("text")
      .attr("class", "axis-annot")
      .attr("x", Math.max(60, width - 40))
      .attr("y", y0 - 4)
      .attr("text-anchor", "end")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.55)
      .attr("font-family", "var(--font-hand)")
      .attr("font-size", 13)
      .text("neutral");

    this.marginsLayer.append("text")
      .attr("class", "axis-annot")
      .attr("x", width / 2).attr("y", 24)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-hand)").attr("font-size", 16)
      .attr("font-style", "italic")
      .text("↑ hopeful");
    this.marginsLayer.append("text")
      .attr("class", "axis-annot")
      .attr("x", width / 2).attr("y", height - 22)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-hand)").attr("font-size", 16)
      .attr("font-style", "italic")
      .text("fearful ↓");

    this.marginsLayer.append("text")
      .attr("class", "axis-annot time-anchor")
      .attr("x", 40).attr("y", height - 6)
      .attr("text-anchor", "start")
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)").attr("font-size", 10)
      .attr("letter-spacing", "0.04em")
      .text(DATE_LABEL(tDomain[0]));
    this.marginsLayer.append("text")
      .attr("class", "axis-annot time-anchor")
      .attr("x", Math.max(60, width - 40)).attr("y", height - 6)
      .attr("text-anchor", "end")
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)").attr("font-size", 10)
      .attr("letter-spacing", "0.04em")
      .text(DATE_LABEL(tDomain[1]));

    const keyX = 40, keyY = 24;
    const keyGroup = this.marginsLayer.append("g").attr("class", "size-key");
    const keySizes = [3, 5, 8];
    keySizes.forEach((s, i) => {
      keyGroup.append("circle")
        .attr("cx", keyX + i * 14).attr("cy", keyY)
        .attr("r", s)
        .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.35)
        .attr("stroke", "var(--ink-soft)").attr("stroke-opacity", 0.4)
        .attr("stroke-width", 0.5);
    });
    keyGroup.append("text")
      .attr("x", keyX + keySizes.length * 14 + 4).attr("y", keyY + 3)
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)").attr("font-size", 10)
      .attr("letter-spacing", "0.04em")
      .text("reach");
  }

  private renderGhostAxes(
    width: number,
    height: number,
    x: d3.ScaleTime<number, number>,
    y: d3.ScaleLinear<number, number>,
  ): void {
    this.axesLayer.selectAll("*").remove();

    const leftPad = 40;
    const rightPad = Math.max(60, width - 40);
    const topPad = 40;
    const botPad = height - 40;

    const sentTicks = [-1, -0.5, 0, 0.5, 1];
    sentTicks.forEach(v => {
      const yv = y(v);
      this.axesLayer.append("line")
        .attr("x1", leftPad - 4).attr("x2", leftPad)
        .attr("y1", yv).attr("y2", yv)
        .attr("stroke", "var(--ink-soft)").attr("stroke-opacity", 0.5)
        .attr("stroke-width", 0.8);
      this.axesLayer.append("text")
        .attr("x", leftPad - 6).attr("y", yv + 3)
        .attr("text-anchor", "end")
        .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.7)
        .attr("font-family", "var(--font-mono)").attr("font-size", 10)
        .text(v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    });

    const tTicks = x.ticks(Math.min(4, Math.max(2, Math.floor((rightPad - leftPad) / 120))));
    tTicks.forEach(d => {
      const xv = x(d);
      this.axesLayer.append("line")
        .attr("x1", xv).attr("x2", xv)
        .attr("y1", botPad).attr("y2", botPad + 4)
        .attr("stroke", "var(--ink-soft)").attr("stroke-opacity", 0.5)
        .attr("stroke-width", 0.8);
      this.axesLayer.append("text")
        .attr("x", xv).attr("y", botPad + 15)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.7)
        .attr("font-family", "var(--font-mono)").attr("font-size", 10)
        .text(DATE_LABEL(d));
    });

    this.axesLayer.append("line")
      .attr("x1", leftPad).attr("x2", leftPad)
      .attr("y1", topPad).attr("y2", botPad)
      .attr("stroke", "var(--ink-soft)").attr("stroke-opacity", 0.35)
      .attr("stroke-width", 0.6);
    this.axesLayer.append("line")
      .attr("x1", leftPad).attr("x2", rightPad)
      .attr("y1", botPad).attr("y2", botPad)
      .attr("stroke", "var(--ink-soft)").attr("stroke-opacity", 0.35)
      .attr("stroke-width", 0.6);

    this.axesLayer.append("text")
      .attr("class", "axis-caption")
      .attr("x", (leftPad + rightPad) / 2).attr("y", botPad + 28)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)").attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-serif)").attr("font-size", 11)
      .attr("font-style", "italic")
      .text("horizontal = time  ·  vertical = sentiment  ·  size = reach");
  }
}
