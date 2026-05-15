import * as d3 from "d3";
import type { PostOut, Category } from "../data/api";

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

export class Constellation {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private dotsLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private marginsLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private axesLayer!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private liveRegion!: HTMLDivElement;
  private lastPosts: PostOut[] = [];
  private axesOn = false;
  private ro?: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    // Do not wipe the container: it may contain sibling overlays like `.controls`.
    // Reuse any existing svg we previously mounted, otherwise create one.
    const existing = container.querySelector<SVGSVGElement>(":scope > svg.constellation");
    const node = existing ?? d3.select(container).append("svg")
      .attr("class", "constellation")
      .attr("role", "img")
      .attr("aria-label", "Constellation of AI-sentiment posts")
      .node()!;
    this.svg = d3.select(node);

    let existingLive = container.querySelector<HTMLDivElement>(":scope > .aria-live-region");
    if (!existingLive) {
      existingLive = document.createElement("div");
      existingLive.className = "aria-live-region";
      existingLive.setAttribute("aria-live", "polite");
      existingLive.setAttribute("aria-atomic", "true");
      existingLive.style.position = "absolute";
      existingLive.style.width = "1px";
      existingLive.style.height = "1px";
      existingLive.style.padding = "0";
      existingLive.style.margin = "-1px";
      existingLive.style.overflow = "hidden";
      existingLive.style.clip = "rect(0, 0, 0, 0)";
      existingLive.style.whiteSpace = "nowrap";
      existingLive.style.border = "0";
      container.appendChild(existingLive);
    }
    this.liveRegion = existingLive;

    // Persistent layer structure: margins under dots, ghost-axes above dots.
    // Re-using existing groups if we were re-constructed keeps things idempotent
    // (matches the pre-existing svg reuse policy for sibling overlays).
    this.marginsLayer = this.ensureLayer("margins");
    this.dotsLayer = this.ensureLayer("dots");
    this.axesLayer = this.ensureLayer("ghost-axes");
    this.axesLayer.attr("display", this.axesOn ? null : "none");

    // Keep the SVG sized to the container even when the browser delays layout
    // (common on iOS Safari where the initial getBoundingClientRect can be 0x0).
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

  /**
   * Toggle explicit tick-labeled axes for viewers who want precise orientation.
   * The marginalia layer (hopeful/fearful/dates/neutral line) stays visible
   * regardless -- this only controls the opt-in numerical grid.
   */
  setAxes(on: boolean): void {
    this.axesOn = on;
    this.axesLayer.attr("display", on ? null : "none");
    if (this.lastPosts.length) this.render(this.lastPosts);
  }

  getAxes(): boolean {
    return this.axesOn;
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
      // Fall back to the parent .canvas box — the svg relies on CSS 100%/100%
      // and may report 0x0 on first paint before layout settles.
      const pr = this.container.getBoundingClientRect();
      if (width < 2) width = pr.width;
      if (height < 2) height = pr.height;
    }
    if (width < 2) width = window.innerWidth;
    if (height < 2) height = Math.max(320, Math.round(window.innerHeight * 0.6));
    return { width, height };
  }

  render(posts: PostOut[]): void {
    this.lastPosts = posts;
    const { width, height } = this.measure();

    // If we still can't measure anything, defer to the next frame. This guards
    // against the first render firing while the landing overlay is still
    // fading out and the stage hasn't been laid out yet.
    if (width < 2 || height < 2) {
      requestAnimationFrame(() => this.render(posts));
      return;
    }

    if (posts.length === 0) {
      this.dotsLayer.selectAll<SVGPathElement, PostOut>("path.dot").remove();
      this.marginsLayer.selectAll("*").remove();
      this.axesLayer.selectAll("*").remove();
      return;
    }

    const tExtent = d3.extent(posts, p => new Date(p.published_at)) as [Date, Date];
    const tDomain: [Date, Date] = tExtent[0] && tExtent[1] && +tExtent[0] !== +tExtent[1]
      ? tExtent
      : [new Date(Date.now() - 86400_000), new Date()];
    const x = d3.scaleTime().domain(tDomain).range([40, Math.max(60, width - 40)]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 40, 40]);
    const r = d3.scaleSqrt().domain([0, d3.max(posts, p => p.reach) || 1]).range([3, 10]);

    // --- Marginalia: always-on orientation cues ---------------------------
    this.renderMargins(width, height, y, tDomain);

    // --- Ghost axes: opt-in, strict tick/label grid -----------------------
    if (this.axesOn) {
      this.renderGhostAxes(width, height, x, y);
    } else {
      this.axesLayer.selectAll("*").remove();
    }

    // --- Dots -------------------------------------------------------------
    const sel = this.dotsLayer.selectAll<SVGPathElement, PostOut>("path.dot")
      .data(posts, (d: any) => d.id);

    sel.exit().transition().duration(500).attr("opacity", 0).remove();

    const enter = sel.enter().append("path")
      .attr("class", "dot")
      .attr("data-cat", d => d.category)
      .attr("transform", d => `translate(${x(new Date(d.published_at))},${y(d.sentiment)})`)
      .attr("d", d => shapePath(d.category, r(d.reach || 0)))
      .attr("fill", d => COLORS[d.category])
      .attr("fill-opacity", 0.0)
      .attr("stroke", "var(--ink)")
      .attr("stroke-width", 0.6)
      .attr("tabindex", "0")
      .attr("role", "link")
      .attr("aria-label", d => `${d.title}, source: ${d.source}, sentiment: ${formatSent(d.sentiment)}, reach: ${formatReach(d.reach)}`)
      .style("cursor", "pointer")
      .style("outline", "none")
      .on("click", (_, d) => window.open(d.url, "_blank", "noopener"))
      .on("keydown", (e, d) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.open(d.url, "_blank", "noopener");
        }
      })
      .on("focus", (e, d) => {
        d3.select(e.currentTarget).attr("stroke-width", 2.5);
        if (this.liveRegion) {
          this.liveRegion.textContent = `${d.title}. Sentiment: ${formatSent(d.sentiment)}, reach: ${formatReach(d.reach)}.`;
        }
        window.dispatchEvent(new CustomEvent("dot-focus", { detail: d }));
      })
      .on("blur", (e) => {
        d3.select(e.currentTarget).attr("stroke-width", 0.6);
      });

    enter.append("title").text(d =>
      `${d.title}  [${d.source}]  ·  sent ${formatSent(d.sentiment)}  ·  reach ${formatReach(d.reach)}`
    );

    enter.transition().duration(700).attr("fill-opacity", 0.75);

    sel.transition().duration(600)
      .attr("transform", d => `translate(${x(new Date(d.published_at))},${y(d.sentiment)})`)
      .attr("d", d => shapePath(d.category, r(d.reach || 0)));

    // Refresh titles for existing dots so sentiment/reach updates stay accurate.
    sel.select<SVGTitleElement>("title").text(d =>
      `${d.title}  [${d.source}]  ·  sent ${formatSent(d.sentiment)}  ·  reach ${formatReach(d.reach)}`
    );
  }

  private renderMargins(
    width: number,
    height: number,
    y: d3.ScaleLinear<number, number>,
    tDomain: [Date, Date],
  ): void {
    // Clear previous pass; margins are cheap to re-emit and always tied to
    // the current measured dimensions.
    this.marginsLayer.selectAll("*").remove();

    // Neutral (y=0) line -- subtle dashed horizontal rule so viewers can see
    // which side of "neutral" a dot sits on. The single highest-leverage hint.
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

    // Top / bottom sentiment anchors -- hand-lettered, not tick-marked.
    this.marginsLayer.append("text")
      .attr("class", "axis-annot")
      .attr("x", width / 2)
      .attr("y", 24)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-hand)")
      .attr("font-size", 16)
      .attr("font-style", "italic")
      .text("↑ hopeful");
    this.marginsLayer.append("text")
      .attr("class", "axis-annot")
      .attr("x", width / 2)
      .attr("y", height - 22)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-hand)")
      .attr("font-size", 16)
      .attr("font-style", "italic")
      .text("fearful ↓");

    // Time anchors -- leftmost / rightmost dates, styled as marginalia.
    this.marginsLayer.append("text")
      .attr("class", "axis-annot time-anchor")
      .attr("x", 40)
      .attr("y", height - 6)
      .attr("text-anchor", "start")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", 10)
      .attr("letter-spacing", "0.04em")
      .text(DATE_LABEL(tDomain[0]));
    this.marginsLayer.append("text")
      .attr("class", "axis-annot time-anchor")
      .attr("x", Math.max(60, width - 40))
      .attr("y", height - 6)
      .attr("text-anchor", "end")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", 10)
      .attr("letter-spacing", "0.04em")
      .text(DATE_LABEL(tDomain[1]));

    // Size key -- three dots ascending to demystify the reach encoding.
    const keyX = 40;
    const keyY = 24;
    const keyGroup = this.marginsLayer.append("g").attr("class", "size-key");
    const keySizes = [3, 5, 8];
    keySizes.forEach((s, i) => {
      keyGroup.append("circle")
        .attr("cx", keyX + i * 14)
        .attr("cy", keyY)
        .attr("r", s)
        .attr("fill", "var(--ink-soft)")
        .attr("fill-opacity", 0.35)
        .attr("stroke", "var(--ink-soft)")
        .attr("stroke-opacity", 0.4)
        .attr("stroke-width", 0.5);
    });
    keyGroup.append("text")
      .attr("x", keyX + keySizes.length * 14 + 4)
      .attr("y", keyY + 3)
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.6)
      .attr("font-family", "var(--font-mono)")
      .attr("font-size", 10)
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

    // Sentiment ticks along the left edge.
    const sentTicks = [-1, -0.5, 0, 0.5, 1];
    sentTicks.forEach(v => {
      const yv = y(v);
      this.axesLayer.append("line")
        .attr("x1", leftPad - 4).attr("x2", leftPad)
        .attr("y1", yv).attr("y2", yv)
        .attr("stroke", "var(--ink-soft)")
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", 0.8);
      this.axesLayer.append("text")
        .attr("x", leftPad - 6)
        .attr("y", yv + 3)
        .attr("text-anchor", "end")
        .attr("fill", "var(--ink-soft)")
        .attr("fill-opacity", 0.7)
        .attr("font-family", "var(--font-mono)")
        .attr("font-size", 10)
        .text(v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1));
    });

    // Time ticks along the bottom edge (4 evenly-spaced).
    const tTicks = x.ticks(Math.min(4, Math.max(2, Math.floor((rightPad - leftPad) / 120))));
    tTicks.forEach(d => {
      const xv = x(d);
      this.axesLayer.append("line")
        .attr("x1", xv).attr("x2", xv)
        .attr("y1", botPad).attr("y2", botPad + 4)
        .attr("stroke", "var(--ink-soft)")
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", 0.8);
      this.axesLayer.append("text")
        .attr("x", xv)
        .attr("y", botPad + 15)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--ink-soft)")
        .attr("fill-opacity", 0.7)
        .attr("font-family", "var(--font-mono)")
        .attr("font-size", 10)
        .text(DATE_LABEL(d));
    });

    // Frame rules (left + bottom) -- reinforces "this is a plot right now".
    this.axesLayer.append("line")
      .attr("x1", leftPad).attr("x2", leftPad)
      .attr("y1", topPad).attr("y2", botPad)
      .attr("stroke", "var(--ink-soft)")
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 0.6);
    this.axesLayer.append("line")
      .attr("x1", leftPad).attr("x2", rightPad)
      .attr("y1", botPad).attr("y2", botPad)
      .attr("stroke", "var(--ink-soft)")
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", 0.6);

    // Caption just above the bottom frame.
    this.axesLayer.append("text")
      .attr("class", "axis-caption")
      .attr("x", (leftPad + rightPad) / 2)
      .attr("y", botPad + 28)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-soft)")
      .attr("fill-opacity", 0.7)
      .attr("font-family", "var(--font-serif)")
      .attr("font-size", 11)
      .attr("font-style", "italic")
      .text("horizontal = time  ·  vertical = sentiment  ·  size = reach");
  }
}
