import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as d3 from "d3";
import { Constellation } from "./constellation";
import type { PostOut } from "../data/api";

function makePost(id: string, overrides: Partial<PostOut> = {}): PostOut {
  return {
    id,
    source: "gdelt",
    category: "business",
    title: `Post ${id}`,
    snippet: "",
    url: `https://example.com/${id}`,
    author: "",
    published_at: new Date("2025-06-01T00:00:00Z").toISOString(),
    sentiment: 0.1,
    emotions: {},
    topics: [],
    reach: 1,
    ...overrides,
  };
}

// jsdom doesn't implement ResizeObserver; capture the callback so tests can fire it.
let roCallback: ((entries: unknown) => void) | null = null;

class MockResizeObserver {
  constructor(cb: (entries: unknown) => void) {
    roCallback = cb;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function setBox(el: Element, width: number, height: number): void {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      toJSON() {},
    }),
  });
}

describe("Constellation", () => {
  let canvas: HTMLDivElement;

  beforeEach(() => {
    roCallback = null;
    // @ts-expect-error jsdom doesn't ship ResizeObserver
    globalThis.ResizeObserver = MockResizeObserver;
    document.body.innerHTML = "";
    canvas = document.createElement("div");
    canvas.className = "canvas";
    document.body.appendChild(canvas);
    setBox(canvas, 800, 600);
  });

  afterEach(() => {
    // Cancel any in-flight d3 transitions before teardown. jsdom's SVG
    // transform attribute returns an undefined baseVal, which crashes
    // d3-interpolate's transform parser when a transition tick fires
    // after the test completes.
    d3.selectAll("svg.constellation *").interrupt();
    document.body.innerHTML = "";
  });

  it("does not wipe existing sibling overlays in the container", () => {
    const controls = document.createElement("div");
    controls.className = "controls";
    controls.textContent = "Pause";
    canvas.appendChild(controls);

    new Constellation(canvas);

    // controls must survive construction (the old implementation wiped innerHTML).
    expect(canvas.querySelector(".controls")).not.toBeNull();
    expect(canvas.querySelector("svg.constellation")).not.toBeNull();
  });

  it("reuses the existing svg on re-construction instead of stacking them", () => {
    new Constellation(canvas);
    new Constellation(canvas);
    expect(canvas.querySelectorAll("svg.constellation").length).toBe(1);
  });

  it("falls back to container size when the svg reports 0x0", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 0, 0);
    setBox(canvas, 400, 300);

    c.render([makePost("a"), makePost("b", { published_at: new Date("2025-07-01T00:00:00Z").toISOString() })]);

    // Dots should be rendered using the container's fallback size.
    expect(canvas.querySelectorAll("path.dot").length).toBe(2);
  });

  it("defers render via requestAnimationFrame when everything measures zero", async () => {
    setBox(canvas, 0, 0);
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 0, 0);

    // Pretend innerWidth is also zero so the last fallback can't save us the first time.
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 0 });
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 0 });

    const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

    c.render([makePost("a")]);

    expect(rafSpy).toHaveBeenCalled();
    // No dots yet because we bailed out.
    expect(canvas.querySelectorAll("path.dot").length).toBe(0);

    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("re-renders when the ResizeObserver fires with new dimensions", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([makePost("a"), makePost("b", { published_at: new Date("2025-08-01T00:00:00Z").toISOString() })]);
    expect(canvas.querySelectorAll("path.dot").length).toBe(2);

    // Shrink to tablet width; the observer should trigger a re-render with the new scale.
    setBox(svg, 400, 300);
    roCallback?.([]);
    expect(canvas.querySelectorAll("path.dot").length).toBe(2);
  });

  it("applies the enter fill-opacity transition to <path>, not <title>", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([makePost("a")]);

    const path = canvas.querySelector("path.dot");
    expect(path).not.toBeNull();
    // d3 transitions are async; but the attribute should at minimum be set on the path,
    // and the <title> should be a child of the path, not the transition target.
    expect(path!.querySelector("title")?.textContent).toMatch(/Post a/);
    // fill-opacity attribute exists on the path (starts at 0, animates to 0.75).
    expect(path!.getAttribute("fill-opacity")).not.toBeNull();
  });

  it("clears dots without throwing when posts is empty", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([makePost("a")]);
    expect(canvas.querySelectorAll("path.dot").length).toBe(1);

    expect(() => c.render([])).not.toThrow();
    expect(canvas.querySelectorAll("path.dot").length).toBe(0);
    // Margins cleared when there's nothing to orient.
    expect(canvas.querySelector("g.margins")?.children.length ?? 0).toBe(0);
  });

  it("renders hopeful/fearful margin labels, a neutral line, and date anchors", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([
      makePost("a", { published_at: new Date("2025-06-01T00:00:00Z").toISOString() }),
      makePost("b", { published_at: new Date("2025-06-10T00:00:00Z").toISOString() }),
    ]);

    const margins = canvas.querySelector("g.margins")!;
    const annots = Array.from(margins.querySelectorAll("text.axis-annot")).map(t => t.textContent);
    expect(annots).toContain("↑ hopeful");
    expect(annots).toContain("fearful ↓");
    expect(annots).toContain("neutral");
    // Date anchors use the pre-configured d3.timeFormat("%b %-d").
    expect(annots.some(a => a && /Jun\s\d+/.test(a))).toBe(true);

    // Neutral line exists and spans the plot width.
    const neutral = margins.querySelector("line.neutral-line") as SVGLineElement | null;
    expect(neutral).not.toBeNull();
    expect(Number(neutral!.getAttribute("x1"))).toBe(40);

    // Size key — three dots + label.
    const sizeKey = margins.querySelector("g.size-key")!;
    expect(sizeKey.querySelectorAll("circle").length).toBe(3);
    expect(sizeKey.querySelector("text")?.textContent).toBe("reach");
  });

  it("tooltip on each dot includes sentiment and reach", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([makePost("a", { sentiment: -0.42, reach: 1300 })]);

    const title = canvas.querySelector("path.dot title")?.textContent ?? "";
    expect(title).toMatch(/sent\s+-0\.42/);
    expect(title).toMatch(/reach\s+1\.3k/);
  });

  it("ghost axes hidden by default, revealed on setAxes(true)", () => {
    const c = new Constellation(canvas);
    const svg = canvas.querySelector("svg.constellation")!;
    setBox(svg, 800, 600);
    c.render([makePost("a"), makePost("b", { published_at: new Date("2025-07-01T00:00:00Z").toISOString() })]);

    const axesLayer = canvas.querySelector("g.ghost-axes") as SVGGElement;
    expect(axesLayer).not.toBeNull();
    expect(axesLayer.getAttribute("display")).toBe("none");
    // No children rendered while hidden.
    expect(axesLayer.children.length).toBe(0);
    expect(c.getAxes()).toBe(false);

    c.setAxes(true);
    expect(c.getAxes()).toBe(true);
    expect(axesLayer.getAttribute("display")).not.toBe("none");
    // Ticks and caption populated.
    expect(axesLayer.querySelectorAll("text").length).toBeGreaterThan(3);
    const captionTexts = Array.from(axesLayer.querySelectorAll("text")).map(t => t.textContent ?? "");
    expect(captionTexts.some(t => /horizontal = time/.test(t))).toBe(true);
    // Sentiment tick labels (+1.0, +0.5, 0.0, -0.5, -1.0) should all be present.
    for (const label of ["+1.0", "+0.5", "0.0", "-0.5", "-1.0"]) {
      expect(captionTexts).toContain(label);
    }

    c.setAxes(false);
    expect(axesLayer.getAttribute("display")).toBe("none");
    expect(axesLayer.children.length).toBe(0);
  });

  it("does not add duplicate layers when the constellation is re-constructed", () => {
    new Constellation(canvas);
    new Constellation(canvas);
    // One of each layer, no matter how many constructors ran.
    expect(canvas.querySelectorAll("g.dots").length).toBe(1);
    expect(canvas.querySelectorAll("g.margins").length).toBe(1);
    expect(canvas.querySelectorAll("g.ghost-axes").length).toBe(1);
  });
});
