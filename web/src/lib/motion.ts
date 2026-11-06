export const prefersReducedMotion = () =>
  typeof window !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Eases a number from `from` to `to` over 600ms (ease-out quart), like the original page.
export function tween(from: number, to: number, onFrame: (v: number) => void): () => void {
  if (prefersReducedMotion()) {
    onFrame(to);
    return () => {};
  }
  const t0 = performance.now();
  let raf = 0;
  const step = (now: number) => {
    const k = Math.min(1, (now - t0) / 600);
    const e = 1 - Math.pow(1 - k, 4);
    onFrame(from + (to - from) * e);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  step(t0);
  return () => cancelAnimationFrame(raf);
}
