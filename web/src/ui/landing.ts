export function mountLanding(onEnter: () => Promise<void>): void {
  const el = document.createElement("div");
  el.className = "landing";
  el.innerHTML = `
    <div class="card">
      <h1>Listening to the Machine</h1>
      <p>A decade of human sentiment about artificial intelligence, rendered as ambient sound. Public voices, business headlines, and scientific papers are each given their own instrument. Drift through time; click any mark to read the original source.</p>
      <button type="button" aria-label="Enter the piece">Enter</button>
    </div>
  `;
  const btn = el.querySelector("button")!;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Loading...";
    
    try {
      await onEnter();
      el.style.transition = "opacity 800ms ease";
      el.style.opacity = "0";
      setTimeout(() => { el.remove(); }, 800);
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });
  document.body.appendChild(el);
}
