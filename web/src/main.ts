import { fetchWindow } from "./data/api";
import { AudioEngine } from "./audio/engine";
import { Constellation } from "./viz/constellation";
import { Scrubber } from "./viz/scrubber";
import { attachQuoteCards } from "./viz/quoteCards";
import { renderDrawer } from "./ui/drawer";
import { mountStudio } from "./ui/studio";
import { mountLanding } from "./ui/landing";

const TIMELINE_START = new Date("2015-01-01T00:00:00Z");

function mountStage(): { canvasEl: HTMLElement; drawerEl: HTMLElement; scrubberEl: HTMLElement; topbar: HTMLElement } {
  const root = document.getElementById("app")!;
  root.innerHTML = `
    <div class="stage" role="application" aria-label="AI sentiment sonification stage">
      <header class="topbar">
        <span class="title">Listening to the Machine</span>
        <div class="modes" role="group" aria-label="Playback mode">
          <button data-mode="live">Live</button>
          <button data-mode="retro">Retrospective</button>
          <button data-mode="explore" class="active" aria-pressed="true">Explore</button>
        </div>
      </header>
      <section class="canvas" aria-label="Constellation">
        <div class="controls">
          <button class="chip" id="playBtn" aria-label="Pause audio">Pause</button>
          <button class="chip" id="studioBtn" aria-label="Toggle studio panel" title="Press S">Studio</button>
        </div>
      </section>
      <aside class="drawer" aria-label="Source drawer"></aside>
      <footer class="scrubber" aria-label="Timeline scrubber"></footer>
    </div>
  `;
  return {
    canvasEl: root.querySelector(".canvas") as HTMLElement,
    drawerEl: root.querySelector(".drawer") as HTMLElement,
    scrubberEl: root.querySelector(".scrubber") as HTMLElement,
    topbar: root.querySelector(".topbar") as HTMLElement,
  };
}

async function begin(): Promise<void> {
  const { canvasEl, drawerEl, scrubberEl, topbar } = mountStage();
  const engine = new AudioEngine();
  await engine.start();
  mountStudio(engine);
  attachQuoteCards(canvasEl);

  const constellation = new Constellation(canvasEl);
  const now = new Date();
  const scrubber = new Scrubber(scrubberEl, {
    start: TIMELINE_START,
    end: now,
    onWindow: (from, to) => refresh(from, to),
  });

  const [from0, to0] = scrubber.getWindow();
  await refresh(from0, to0);

  // Play/pause + mode buttons
  const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
  let playing = true;
  playBtn.addEventListener("click", () => {
    playing = !playing;
    engine.setMix({ master: playing ? 0.8 : 0.0 });
    playBtn.textContent = playing ? "Pause" : "Play";
    playBtn.setAttribute("aria-label", playing ? "Pause audio" : "Play audio");
  });
  (document.getElementById("studioBtn") as HTMLButtonElement).addEventListener("click", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
  });

  topbar.querySelectorAll<HTMLButtonElement>(".modes button").forEach(btn => {
    btn.addEventListener("click", () => {
      topbar.querySelectorAll(".modes button").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
      btn.classList.add("active"); btn.setAttribute("aria-pressed", "true");
      const mode = btn.dataset.mode;
      if (mode === "live") startLiveMode(scrubber, refresh);
      else if (mode === "retro") startRetroMode(scrubber, refresh);
    });
  });

  // Keyboard nav: arrow keys step window
  window.addEventListener("keydown", (e) => {
    const [f, t] = scrubber.getWindow();
    let days = 0;
    if (e.key === "ArrowRight") days = e.shiftKey ? 7 : e.altKey ? 30 : 1;
    if (e.key === "ArrowLeft")  days = -(e.shiftKey ? 7 : e.altKey ? 30 : 1);
    if (days !== 0) {
      const nf = new Date(f.getTime() + days * 86400_000);
      const nt = new Date(t.getTime() + days * 86400_000);
      refresh(nf, nt);
    }
  });

  async function refresh(from: Date, to: Date) {
    try {
      const win = await fetchWindow(from, to);
      constellation.render(win.exemplars);
      renderDrawer(drawerEl, win.exemplars);
      scrubber.draw(win.aggregates);
      engine.updateFromWindow(win.aggregates, win.exemplars);
    } catch (err) {
      console.warn("refresh failed", err);
    }
  }
}

function startLiveMode(scrubber: Scrubber, refresh: (f: Date, t: Date) => Promise<void>) {
  const to = new Date();
  const from = new Date(to.getTime() - 86400_000);
  refresh(from, to);
}

function startRetroMode(scrubber: Scrubber, refresh: (f: Date, t: Date) => Promise<void>) {
  const startMs = TIMELINE_START.getTime();
  const endMs = Date.now();
  const durationMs = 8 * 60 * 1000; // 8 minutes
  const stepMs = 2500;
  const t0 = performance.now();
  const tick = () => {
    const elapsed = performance.now() - t0;
    if (elapsed > durationMs) return;
    const p = elapsed / durationMs;
    const center = startMs + (endMs - startMs) * p;
    const windowW = (endMs - startMs) * 0.03;
    refresh(new Date(center - windowW / 2), new Date(center + windowW / 2));
    setTimeout(tick, stepMs);
  };
  tick();
}

mountLanding(() => { begin(); });
