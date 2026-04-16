import type { AudioEngine } from "../audio/engine";

export function mountStudio(engine: AudioEngine): HTMLElement {
  const panel = document.createElement("aside");
  panel.className = "studio";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Studio controls");
  panel.style.display = "none";
  panel.innerHTML = `
    <h3>Studio</h3>
    <label>Master <input type="range" min="0" max="1" step="0.01" value="0.8" data-ctl="master"></label>
    <label>Public  <input type="range" min="0" max="1" step="0.01" value="0.7" data-ctl="public"></label>
    <label>Business <input type="range" min="0" max="1" step="0.01" value="0.7" data-ctl="business"></label>
    <label>Science <input type="range" min="0" max="1" step="0.01" value="0.7" data-ctl="science"></label>
    <div class="presets" style="margin-top:10px;">
      <button data-preset="archive">Archive</button>
      <button data-preset="newsroom">Newsroom</button>
      <button data-preset="lab">Lab Notebook</button>
      <button data-preset="doom">Doomscroll</button>
      <button data-preset="utopia">Utopia</button>
    </div>
  `;
  panel.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const ctl = t.dataset.ctl;
    if (!ctl) return;
    engine.setMix({ [ctl]: parseFloat(t.value) } as any);
  });
  panel.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const preset = t.dataset.preset;
    if (!preset) return;
    applyPreset(engine, preset);
  });
  document.body.appendChild(panel);

  window.addEventListener("keydown", (e) => {
    if (e.key === "s" || e.key === "S") {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    }
  });
  return panel;
}

function applyPreset(engine: AudioEngine, preset: string) {
  const mixes: Record<string, any> = {
    archive:  { public: 0.6, business: 0.4, science: 0.8, master: 0.7 },
    newsroom: { public: 0.3, business: 0.9, science: 0.3, master: 0.8 },
    lab:      { public: 0.2, business: 0.3, science: 1.0, master: 0.75 },
    doom:     { public: 1.0, business: 0.8, science: 0.2, master: 0.9 },
    utopia:   { public: 0.8, business: 0.4, science: 0.7, master: 0.8 },
  };
  engine.setMix(mixes[preset] ?? {});
}
