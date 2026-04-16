export function mountLanding(onEnter: () => void): void {
  const el = document.createElement("div");
  el.className = "landing";
  el.innerHTML = `
    <div class="card">
      <h1>Listening to the Machine</h1>
      <p>A decade of human sentiment about artificial intelligence, rendered as ambient sound. Public voices, business headlines, and scientific papers are each given their own instrument. Drift through time; click any mark to read the original source.</p>
      <button type="button" aria-label="Enter the piece">Enter</button>
    </div>
  `;
  el.querySelector("button")!.addEventListener("click", () => {
    el.style.transition = "opacity 800ms ease";
    el.style.opacity = "0";
    setTimeout(() => { el.remove(); onEnter(); }, 800);
  });
  document.body.appendChild(el);
}
