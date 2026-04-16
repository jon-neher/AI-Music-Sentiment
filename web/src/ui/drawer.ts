import type { PostOut } from "../data/api";

export function renderDrawer(container: HTMLElement, posts: PostOut[]): void {
  container.innerHTML = `<h2>In this window</h2>` + posts.slice(0, 60).map(p => `
    <div class="row">
      <span class="shape" aria-hidden="true">${shape(p.category)}</span>
      <div>
        <a href="${p.url}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a>
        <div style="font-size:11px;color:var(--ink-soft);font-family:var(--font-mono);margin-top:2px;">
          ${p.source.toUpperCase()} · ${new Date(p.published_at).toLocaleDateString()} · ${(p.sentiment >= 0 ? "+" : "")}${p.sentiment.toFixed(2)}
        </div>
      </div>
    </div>
  `).join("");
}

function shape(cat: string): string {
  if (cat === "public") return `<svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="var(--public)" stroke="var(--ink)"/></svg>`;
  if (cat === "business") return `<svg width="12" height="12"><rect x="1" y="1" width="10" height="10" fill="var(--business)" stroke="var(--ink)"/></svg>`;
  return `<svg width="12" height="12"><polygon points="6,1 11,11 1,11" fill="var(--science)" stroke="var(--ink)"/></svg>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
