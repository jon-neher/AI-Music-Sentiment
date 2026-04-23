import type { PostOut } from "../data/api";

const NARROW_MQ = "(max-width: 900px)";
const NARROW_MAX_CARDS = 2;
const NARROW_LIFETIME_MS = 12_000;
const WIDE_LIFETIME_MS = 8_200;

export function attachQuoteCards(stage: HTMLElement): void {
  window.addEventListener("outlier-bell", (ev: Event) => {
    const p = (ev as CustomEvent<PostOut>).detail;
    if (!p) return;
    spawn(stage, p);
  });
}

function isNarrow(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(NARROW_MQ).matches;
}

function spawn(stage: HTMLElement, p: PostOut): void {
  const narrow = isNarrow();

  if (narrow) {
    // Cap concurrent cards so they can't pile up; drop the oldest.
    const existing = Array.from(stage.querySelectorAll<HTMLElement>(".quotecard"));
    while (existing.length >= NARROW_MAX_CARDS) {
      existing.shift()!.remove();
    }
  }

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

  if (narrow) {
    // Slower, gentler drift on mobile — two cards can be on-screen at once,
    // stacked via the --quote-offset custom property (newest sits lowest).
    el.style.setProperty("--quote-lifetime", `${NARROW_LIFETIME_MS}ms`);
    stage.appendChild(el);
    restackNarrow(stage);
    window.setTimeout(() => { el.remove(); restackNarrow(stage); }, NARROW_LIFETIME_MS + 200);
    return;
  }

  // Desktop: the original scatter look.
  const rect = stage.getBoundingClientRect();
  const maxLeft = Math.max(0, rect.width - 360);
  el.style.left = `${16 + Math.random() * maxLeft}px`;
  el.style.bottom = `${96 + Math.random() * 80}px`;
  stage.appendChild(el);
  window.setTimeout(() => el.remove(), WIDE_LIFETIME_MS);
}

function restackNarrow(stage: HTMLElement): void {
  const cards = Array.from(stage.querySelectorAll<HTMLElement>(".quotecard"));
  // Oldest = index 0 sits highest; newest = last = sits just above the scrubber.
  cards.forEach((el, i) => {
    const offset = cards.length - 1 - i;
    el.style.setProperty("--quote-offset", String(offset));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}
