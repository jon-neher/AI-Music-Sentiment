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
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;

  constructor(container: HTMLElement) {
    container.innerHTML = "";
    this.svg = d3.select(container).append("svg")
      .attr("role", "img")
      .attr("aria-label", "Constellation of AI-sentiment posts");
  }

  render(posts: PostOut[]): void {
    const svgNode = this.svg.node()!;
    const { width, height } = svgNode.getBoundingClientRect();

    const x = d3.scaleTime()
      .domain(d3.extent(posts, p => new Date(p.published_at)) as [Date, Date])
      .range([40, width - 40]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 40, 40]);
    const r = d3.scaleSqrt().domain([0, d3.max(posts, p => p.reach) || 1]).range([3, 10]);

    const sel = this.svg.selectAll<SVGPathElement, PostOut>("path.dot")
      .data(posts, (d: any) => d.id);

    sel.exit().transition().duration(500).attr("opacity", 0).remove();

    const enter = sel.enter().append("path")
      .attr("class", "dot")
      .attr("transform", d => `translate(${x(new Date(d.published_at))},${y(d.sentiment)})`)
      .attr("d", d => shapePath(d.category, r(d.reach || 0)))
      .attr("fill", d => COLORS[d.category])
      .attr("fill-opacity", 0.0)
      .attr("stroke", "var(--ink)")
      .attr("stroke-width", 0.6)
      .style("cursor", "pointer")
      .on("click", (_, d) => window.open(d.url, "_blank", "noopener"))
      .append("title").text(d => `${d.title}  [${d.source}]`);

    enter.select(function () { return this.parentNode as Element; })
      .transition().duration(700)
      .attr("fill-opacity", 0.75);

    sel.transition().duration(600)
      .attr("transform", d => `translate(${x(new Date(d.published_at))},${y(d.sentiment)})`);
  }
}
