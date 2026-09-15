import { html, svg } from "lit";

export const GLASS_LENSES = {
  overall: { id: "gp-progress-refraction", width: 28, height: 20, scale: 7 },
  mini: { id: "gp-mini-progress-refraction", width: 26, height: 18, scale: 6 },
} as const;

// Opposing R/G ramps sample toward the lens center. This magnifies the actual
// backdrop; the map never draws an accent-colored shape inside the handle.
const lensMap = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="x"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#000000"/></linearGradient>
    <linearGradient id="y" x2="0" y2="1"><stop stop-color="#00ff00"/><stop offset="1" stop-color="#000000"/></linearGradient>
  </defs>
  <rect width="32" height="32" fill="url(#x)"/>
  <rect width="32" height="32" fill="url(#y)" style="mix-blend-mode:screen"/>
</svg>`)}`;

export function renderGlassRefraction() {
  return html`<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;pointer-events:none">
    <defs>
      ${Object.values(GLASS_LENSES).map(
        (lens) => svg`
        <filter id=${lens.id} x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
          <feImage href=${lensMap} x="0" y="0" width=${lens.width} height=${lens.height} preserveAspectRatio="none" result="lens" />
          <feDisplacementMap in="SourceGraphic" in2="lens" scale=${lens.scale} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      `,
      )}
    </defs>
  </svg>`;
}
