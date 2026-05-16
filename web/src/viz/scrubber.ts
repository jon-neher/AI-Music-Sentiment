import * as d3 from "d3";
import type { AggregateOut } from "../data/api";

const DAY_MS = 86400_000;
const DRAG_EMIT_THROTTLE_MS = 140;

export interface ScrubberOpts {
  start: Date;
  end: Date;
  onWindow: (from: Date, to: Date) => void;
  onInteract?: () => void;
}

export class Scrubber {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private opts: ScrubberOpts;
  private windowFrom: Date;
  private windowTo: Date;
  private lastAggregates: AggregateOut[] = [];
  private lastEmitMs = 0;
  private redrawQueued = false;

  constructor(container: HTMLElement, opts: ScrubberOpts) {
    this.opts = opts;
    this.windowFrom = new Date(opts.end.getTime() - 1000 * 60 * 60 * 24 * 30);
    this.windowTo = opts.end;
    container.innerHTML = "";
    this.svg = d3.select(container).append("svg")
      .style("touch-action", "none")
      .style("user-select", "none")
      .style("-webkit-user-select", "none");
    this.draw([]);

    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => this.queueRedraw());
      ro.observe(container);
    }
    window.addEventListener("resize", () => this.queueRedraw(), { passive: true });
  }

  private queueRedraw(): void {
    if (this.redrawQueued) return;
    this.redrawQueued = true;
    requestAnimationFrame(() => {
      this.redrawQueued = false;
      this.draw(this.lastAggregates);
    });
  }

  private clampWindow(from: Date, to: Date): [Date, Date] {
    const domainStart = this.opts.start.getTime();
    const domainEnd = this.opts.end.getTime();
    const domainSpan = Math.max(DAY_MS, domainEnd - domainStart);

    const fromMs = from.getTime();
    const toMs = to.getTime();
    const center = (fromMs + toMs) / 2;
    const span = Math.min(domainSpan, Math.max(DAY_MS, Math.abs(toMs - fromMs)));

    const minCenter = domainStart + span / 2;
    const maxCenter = domainEnd - span / 2;
    const boundedCenter = Math.max(minCenter, Math.min(maxCenter, center));

    return [new Date(boundedCenter - span / 2), new Date(boundedCenter + span / 2)];
  }

  private emitWindow(force = false): void {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!force && now - this.lastEmitMs < DRAG_EMIT_THROTTLE_MS) return;
    this.lastEmitMs = now;
    this.opts.onWindow(new Date(this.windowFrom), new Date(this.windowTo));
  }

  setWindow(from: Date, to: Date, emit = true): void {
    [this.windowFrom, this.windowTo] = this.clampWindow(from, to);
    this.draw(this.lastAggregates);
    if (emit) this.emitWindow(true);
  }

  shiftByDays(days: number, emit = true): void {
    const delta = days * DAY_MS;
    this.setWindow(
      new Date(this.windowFrom.getTime() + delta),
      new Date(this.windowTo.getTime() + delta),
      emit,
    );
  }

  shiftByFraction(fraction: number, emit = true): void {
    const span = this.windowTo.getTime() - this.windowFrom.getTime();
    const delta = span * fraction;
    this.setWindow(
      new Date(this.windowFrom.getTime() + delta),
      new Date(this.windowTo.getTime() + delta),
      emit,
    );
  }

  jumpToLatest(emit = true): void {
    const span = this.windowTo.getTime() - this.windowFrom.getTime();
    this.setWindow(
      new Date(this.opts.end.getTime() - span),
      new Date(this.opts.end),
      emit,
    );
  }

  draw(aggregates: AggregateOut[]): void {
    this.lastAggregates = aggregates;
    const svgNode = this.svg.node()!;
    const { width, height } = svgNode.getBoundingClientRect();
    if (width === 0) return;

    const pad = 16;
    const x = d3.scaleTime().domain([this.opts.start, this.opts.end]).range([pad, width - pad]);
    const y = d3.scaleLinear().domain([-1, 1]).range([height - 8, 8]);

    [this.windowFrom, this.windowTo] = this.clampWindow(this.windowFrom, this.windowTo);

    this.svg.selectAll("*").remove();

    // Neutral axis at sentiment = 0
    this.svg.append("line")
      .attr("x1", pad).attr("x2", width - pad)
      .attr("y1", y(0)).attr("y2", y(0))
      .attr("stroke", "rgba(0,0,0,0.25)").attr("stroke-dasharray", "2 3");

    // ---- Divergence band (subtle) + mean-of-means baseline ---------------
    // Per-day stats across categories. Min/max → the spread band; the mean is
    // the baseline the colored lines visibly diverge from.
    const byDay = d3.rollups(
      aggregates,
      rows => {
        const byCat: Record<string, number> = {};
        for (const r of rows) byCat[r.category] = r.mean_sentiment;
        const vals = Object.values(byCat);
        return { vals, n: vals.length };
      },
      d => d.day,
    );
    const dayStats = byDay
      .map(([day, { vals, n }]) => {
        if (n === 0) return null;
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const mean = vals.reduce((a, b) => a + b, 0) / n;
        return { day: new Date(day), min: mn, max: mx, mean, spread: mx - mn, n };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null && d.n >= 2)
      .sort((a, b) => +a.day - +b.day);

    if (dayStats.length >= 2) {
      // The fill opacity is modulated by the *median* spread so calm stretches
      // stay ghostly and dramatic fights actually show up as shadow.
      const spreads = dayStats.map(d => d.spread).sort((a, b) => a - b);
      const medianSpread = spreads[Math.floor(spreads.length / 2)] ?? 0;
      const bandOpacity = Math.min(0.14, 0.04 + medianSpread * 0.14);

      const area = d3.area<(typeof dayStats)[number]>()
        .x(d => x(d.day))
        .y0(d => y(d.min))
        .y1(d => y(d.max))
        .curve(d3.curveCatmullRom);

      this.svg.append("path")
        .attr("class", "divergence-band")
        .attr("d", area(dayStats) ?? "")
        .attr("fill", "var(--ink)")
        .attr("fill-opacity", bandOpacity);

      const meanLine = d3.line<(typeof dayStats)[number]>()
        .x(d => x(d.day))
        .y(d => y(d.mean))
        .curve(d3.curveCatmullRom);

      this.svg.append("path")
        .attr("class", "mean-line")
        .attr("d", meanLine(dayStats) ?? "")
        .attr("fill", "none")
        .attr("stroke", "var(--ink)")
        .attr("stroke-width", 0.8)
        .attr("stroke-dasharray", "3 4")
        .attr("opacity", 0.35);
    }

    // ---- Per-category lines ---------------------------------------------
    const byCat = d3.group(aggregates, d => d.category);
    const color: Record<string, string> = { public: "var(--public)", business: "var(--business)", science: "var(--science)" };

    for (const [cat, rows] of byCat) {
      const sorted = [...rows].sort((a, b) => +new Date(a.day) - +new Date(b.day));
      const line = d3.line<AggregateOut>()
        .x(d => x(new Date(d.day)))
        .y(d => y(d.mean_sentiment))
        .curve(d3.curveCatmullRom);
      this.svg.append("path")
        .attr("class", "cat-line")
        .attr("data-cat", cat)
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

    const moveWindowTo = (pixelX: number) => {
      const spanPx = Math.max(2, x(this.windowTo).valueOf() - x(this.windowFrom).valueOf());
      const boundedCenter = Math.max(pad + spanPx / 2, Math.min(width - pad - spanPx / 2, pixelX));
      this.windowFrom = x.invert(boundedCenter - spanPx / 2);
      this.windowTo = x.invert(boundedCenter + spanPx / 2);
      drawWindow();
    };

    const drag = d3.drag<SVGSVGElement, unknown>()
      .on("start", (event) => {
        this.opts.onInteract?.();
        moveWindowTo(event.x);
        this.emitWindow(false);
      })
      .on("drag", (event) => {
        moveWindowTo(event.x);
        this.emitWindow(false);
      })
      .on("end", () => {
        this.emitWindow(true);
      });
    this.svg.call(drag as any);

    this.svg.on("click.scrub", (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      this.opts.onInteract?.();
      const [mx] = d3.pointer(event, svgNode);
      moveWindowTo(mx);
      this.emitWindow(true);
    });
  }

  getWindow(): [Date, Date] { return [this.windowFrom, this.windowTo]; }
}
