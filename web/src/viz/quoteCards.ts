import type { PostOut } from "../data/api";

export function attachQuoteCards(stage: HTMLElement): void {
  window.addEventListener("outlier-bell", (ev: Event) => {
    const p = (ev as CustomEvent<PostOut>).detail;
    if (!p) return;
    spawn(stage, p);
  });
}

function spawn(stage: HTMLElement, p: PostOut): void {
  const el = document.createElement("a");
  el.className = "quotecard";
  el.href = p.url;
  el.target = "_blank";
  el.rel = "noopener";
  el.setAttribute("role", "note");
  el.setAttribute("aria-label", `Quote: ${p.title}`);
  el.innerHTML = `
    ${escapeHtml(p.title)}
    <small>${p.source.toUpperCase()} · ${new Date(p.published_at).toLocaleDateString()} · ${p.sentiment >= 0 ? "+" : ""}${p.sentiment.toFixed(2)}</small>
  `;
  const rect = stage.getBoundingClientRect();
  el.style.left = `${16 + Math.random() * Math.max(0, rect.width - 360)}px`;
  el.style.bottom = `${96 + Math.random() * 80}px`;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 8200);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
