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

export class Constellation {
  private container: HTMLElement;
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private lastPosts: PostOut[] = [];
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
      this.svg.selectAll<SVGPathElement, PostOut>("path.dot").remove();
      return;
    }

    const tExtent = d3.extent(posts, p => new Date(p.published_at)) as [Date, Date];
    const x = d3.scaleTime()
      .domain(tExtent[0] && tExtent[1] && +tExtent[0] !== +tExtent[1]
        ? tExtent
        : [new Date(Date.now() - 86400_000), new Date()])
      .range([40, Math.max(60, width - 40)]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 40, 40]);
    const r = d3.scaleSqrt().domain([0, d3.max(posts, p => p.reach) || 1]).range([3, 10]);

    const sel = this.svg.selectAll<SVGPathElement, PostOut>("path.dot")
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
      .style("cursor", "pointer")
      .on("click", (_, d) => window.open(d.url, "_blank", "noopener"));

    enter.append("title").text(d => `${d.title}  [${d.source}]`);

    enter.transition().duration(700).attr("fill-opacity", 0.75);

    sel.transition().duration(600)
      .attr("transform", d => `translate(${x(new Date(d.published_at))},${y(d.sentiment)})`)
      .attr("d", d => shapePath(d.category, r(d.reach || 0)));
  }
}
