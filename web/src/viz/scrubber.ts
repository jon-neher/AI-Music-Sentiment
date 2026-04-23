import * as d3 from "d3";
import type { AggregateOut } from "../data/api";

export interface ScrubberOpts {
  start: Date;
  end: Date;
  onWindow: (from: Date, to: Date) => void;
}

export class Scrubber {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private opts: ScrubberOpts;
  private windowFrom: Date;
  private windowTo: Date;

  constructor(container: HTMLElement, opts: ScrubberOpts) {
    this.opts = opts;
    this.windowFrom = new Date(opts.end.getTime() - 1000 * 60 * 60 * 24 * 30);
    this.windowTo = opts.end;
    container.innerHTML = "";
    this.svg = d3.select(container).append("svg");
    this.draw([]);
  }

  draw(aggregates: AggregateOut[]): void {
    const svgNode = this.svg.node()!;
    const { width, height } = svgNode.getBoundingClientRect();
    if (width === 0) return;

    const x = d3.scaleTime().domain([this.opts.start, this.opts.end]).range([16, width - 16]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 8, 8]);

    this.svg.selectAll("*").remove();

    this.svg.append("line")
      .attr("x1", 16).attr("x2", width - 16)
      .attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", "rgba(0,0,0,0.25)").attr("stroke-dasharray", "2 3");

    const byCat = d3.group(aggregates, d => d.category);
    const color: Record<string, string> = { public: "var(--public)", business: "var(--business)", science: "var(--science)" };

    for (const [cat, rows] of byCat) {
      const sorted = [...rows].sort((a, b) => +new Date(a.day) - +new Date(b.day));
      const line = d3.line<AggregateOut>()
        .x(d => x(new Date(d.day)))
        .y(d => y(d.mean_sentiment))
        .curve(d3.curveCatmullRom);
      this.svg.append("path")
        .attr("d", line(sorted)!)
        .attr("fill", "none")
        .attr("stroke", color[cat] ?? "var(--ink)")
        .attr("stroke-width", 1.2)
        .attr("opacity", 0.85);
    }

    const windowG = this.svg.append("g");
    const drawWindow = () => {
      windowG.selectAll("*").remove();
      windowG.append("rect")
        .attr("x", x(this.windowFrom))
        .attr("width", Math.max(2, x(this.windowTo) - x(this.windowFrom)))
        .attr("y", 4)
        .attr("height", height - 8)
        .attr("fill", "rgba(26,23,19,0.08)")
        .attr("stroke", "var(--ink)")
        .attr("stroke-width", 1);
    };
    drawWindow();

    const drag = d3.drag<SVGSVGElement, unknown>()
      .on("start drag", (event) => {
        const mx = event.x;
        const w = x(this.windowTo).valueOf() - x(this.windowFrom).valueOf();
        const newCenter = Math.max(16 + w / 2, Math.min(width - 16 - w / 2, mx));
        this.windowFrom = x.invert(newCenter - w / 2);
        this.windowTo = x.invert(newCenter + w / 2);
        drawWindow();
      })
      .on("end", () => {
        this.opts.onWindow(this.windowFrom, this.windowTo);
      });
    this.svg.call(drag as any);
  }

  getWindow(): [Date, Date] { return [this.windowFrom, this.windowTo]; }
}
