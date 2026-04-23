import * as d3 from "d3";
import type { AggregateOut, Category } from "../data/api";

export interface CategoryVisibility {
  soloed: Category | null;
  muted: Set<Category>;
}

const CATS: Array<{ key: Category; label: string; shape: "circle" | "square" | "triangle" }> = [
  { key: "public",   label: "Public",   shape: "circle"   },
  { key: "business", label: "Business", shape: "square"   },
  { key: "science",  label: "Science",  shape: "triangle" },
];

/**
 * Marginalia-style category legend. Doubles as the primary interaction surface:
 *   - Tap a chip            → solo (others fade + duck)
 *   - Tap soloed chip again → restore default (all audible)
 *   - Shift+tap / long-press → mute just that category (others keep playing)
 *
 * Emits both a CategoryVisibility state to a callback and mirrors the state onto
 * `<body data-solo="…" data-muted="…">` so pure CSS can dim category lines,
 * constellation dots, and scrubber paths via `var(--opacity-<cat>)`.
 */
export class Legend {
  private state: CategoryVisibility = { soloed: null, muted: new Set() };
  private lastAggregates: AggregateOut[] = [];
  private onChange: (state: CategoryVisibility) => void;

  constructor(private container: HTMLElement, onChange: (state: CategoryVisibility) => void) {
    this.onChange = onChange;
    this.render();
    this.wire();
    this.apply(); // publish initial state so body data-* attributes exist
  }

  /** Update the tiny per-category sparklines + numeric trend on each chip. */
  setWindow(aggregates: AggregateOut[]): void {
    this.lastAggregates = aggregates;
    this.updateTrends();
  }

  getState(): CategoryVisibility {
    return { soloed: this.state.soloed, muted: new Set(this.state.muted) };
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="legend" role="group" aria-label="Category legend. Tap to solo a voice; shift-tap or long-press to mute it.">
        ${CATS.map(c => `
          <button class="legend-chip" data-cat="${c.key}" aria-pressed="false" data-muted="false">
            <span class="legend-shape" aria-hidden="true">${shapeMarkup(c.shape, c.key)}</span>
            <span class="legend-label">${c.label}</span>
            <span class="legend-trend" aria-hidden="true">—</span>
            <svg class="legend-spark" viewBox="0 0 40 12" preserveAspectRatio="none" aria-hidden="true"></svg>
          </button>
        `).join("")}
      </div>
    `;
  }

  private wire(): void {
    this.container.querySelectorAll<HTMLButtonElement>(".legend-chip").forEach(btn => {
      const cat = btn.dataset.cat as Category;

      btn.addEventListener("click", (e) => {
        if (e.shiftKey || (e as MouseEvent).altKey) this.toggleMute(cat);
        else this.toggleSolo(cat);
      });

      // Long-press (mobile-friendly mute) without blocking a normal click.
      let pressTimer: number | null = null;
      let longPressed = false;
      const clear = () => { if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; } };
      btn.addEventListener("pointerdown", () => {
        longPressed = false;
        pressTimer = window.setTimeout(() => {
          longPressed = true;
          pressTimer = null;
          this.toggleMute(cat);
        }, 520);
      });
      btn.addEventListener("pointerup", (e) => {
        clear();
        if (longPressed) e.preventDefault(); // suppress the synthetic click that follows
      });
      btn.addEventListener("pointerleave", clear);
      btn.addEventListener("pointercancel", clear);
      btn.addEventListener("click", (e) => { if (longPressed) { e.preventDefault(); e.stopPropagation(); longPressed = false; } }, true);
    });
  }

  private toggleSolo(cat: Category): void {
    // Tapping a soloed chip a second time clears to default; tapping any other
    // chip switches solo to that category (and clears any previous mutes).
    this.state = {
      soloed: this.state.soloed === cat ? null : cat,
      muted: new Set(),
    };
    this.apply();
  }

  private toggleMute(cat: Category): void {
    const muted = new Set(this.state.muted);
    if (muted.has(cat)) muted.delete(cat); else muted.add(cat);
    this.state = { soloed: null, muted };
    this.apply();
  }

  private apply(): void {
    // Mirror state onto <body> so CSS can fade non-active categories everywhere
    // (constellation dots, scrubber lines) via --opacity-<cat> variables.
    document.body.dataset.solo = this.state.soloed ?? "";
    document.body.dataset.muted = [...this.state.muted].join(" ");

    this.container.querySelectorAll<HTMLButtonElement>(".legend-chip").forEach(btn => {
      const cat = btn.dataset.cat as Category;
      const isSoloed = this.state.soloed === cat;
      const isMuted = this.state.muted.has(cat);
      const isActive = this.state.soloed ? isSoloed : !isMuted;
      btn.classList.toggle("is-solo", isSoloed);
      btn.classList.toggle("is-muted", isMuted);
      btn.dataset.active = String(isActive);
      btn.setAttribute("aria-pressed", String(isSoloed));
    });

    this.onChange(this.getState());
  }

  private updateTrends(): void {
    for (const c of CATS) {
      const chip = this.container.querySelector<HTMLElement>(`.legend-chip[data-cat="${c.key}"]`);
      if (!chip) continue;
      const trendEl = chip.querySelector<HTMLElement>(".legend-trend")!;
      const sparkEl = chip.querySelector<SVGSVGElement>(".legend-spark")!;

      const rows = this.lastAggregates
        .filter(a => a.category === c.key)
        .sort((a, b) => +new Date(a.day) - +new Date(b.day));

      if (rows.length === 0) {
        trendEl.textContent = "—";
        sparkEl.innerHTML = "";
        continue;
      }

      const totalVol = rows.reduce((acc, r) => acc + Math.max(0, r.volume), 0);
      const weighted = totalVol > 0
        ? rows.reduce((acc, r) => acc + r.mean_sentiment * Math.max(0, r.volume), 0) / totalVol
        : (d3.mean(rows, r => r.mean_sentiment) ?? 0);
      const arrow = weighted > 0.03 ? "↑" : weighted < -0.03 ? "↓" : "·";
      trendEl.textContent = `${arrow} ${weighted >= 0 ? "+" : ""}${weighted.toFixed(2)}`;

      const xs = d3.scaleLinear().domain([0, Math.max(1, rows.length - 1)]).range([1, 39]);
      const ys = d3.scaleLinear().domain([-1, 1]).range([11, 1]);
      const line = d3.line<typeof rows[number]>()
        .x((_, i) => xs(i))
        .y(d => ys(d.mean_sentiment))
        .curve(d3.curveCatmullRom);
      const path = line(rows) ?? "";
      sparkEl.innerHTML = path
        ? `<path d="${path}" fill="none" stroke="var(--${c.key})" stroke-width="1" opacity="0.85" stroke-linecap="round" stroke-linejoin="round"/>`
        : "";
    }
  }
}

function shapeMarkup(shape: "circle" | "square" | "triangle", cat: Category): string {
  const fill = `var(--${cat})`;
  if (shape === "circle") {
    return `<svg width="11" height="11" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${fill}" stroke="var(--ink)" stroke-width="0.8"/></svg>`;
  }
  if (shape === "square") {
    return `<svg width="11" height="11" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="${fill}" stroke="var(--ink)" stroke-width="0.8"/></svg>`;
  }
  return `<svg width="11" height="11" viewBox="0 0 12 12"><polygon points="6,1 11,11 1,11" fill="${fill}" stroke="var(--ink)" stroke-width="0.8"/></svg>`;
}
