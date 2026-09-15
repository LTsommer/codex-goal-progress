import { css } from "lit";
import { GLASS_LENSES } from "../components/glass-refraction.js";

export const progressStyles = css`
    .overall {
      --gp-progress-tone: var(--gp-accent);
      --gp-progress-bright: color-mix(in oklab, var(--gp-accent) 74%, var(--gp-panel));
      position: relative;
      display: grid;
      min-height: 35px;
      align-items: center;
      border-top: 1px solid var(--gp-line);
      padding: 3px 0 3px 12px;
    }

    .overall.compact {
      margin: 0;
      border-top: 0;
      padding: 3px 0 3px 12px;
    }

    .overall-rail {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto 24px;
      align-items: center;
      gap: 14px;
    }

    .overall-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--gp-text);
      font-size: var(--gp-font-size);
      font-weight: var(--gp-native-title-font-weight, 400);
      white-space: nowrap;
    }

    .overall-percent {
      flex: none;
      width: 4ch;
      margin-inline-start: 2.5px;
      color: var(--gp-progress-tone);
      font-size: var(--gp-font-size);
      font-variant-numeric: tabular-nums;
      font-weight: 740;
      line-height: 1;
      direction: ltr;
      text-align: center;
      unicode-bidi: isolate;
    }

    .disclosure-icon {
      display: block;
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-width: 1.5;
    }

    .collapse-toggle {
      position: absolute;
      top: 50%;
      left: var(--gp-native-last-control-center, calc(100% - 12px));
      width: 24px;
      height: 24px;
      border-radius: 10px;
      transform: translate(-50%, -50%);
    }

    .overall-track {
      position: relative;
      height: 10px;
      border-radius: 999px;
      background: linear-gradient(
        180deg,
        color-mix(in srgb, var(--gp-track) 65%, transparent),
        var(--gp-track)
      );
      box-shadow: inset 0 1px 2px var(--gp-track-shadow);
      transform: translateY(0.75px);
    }

    .overall-fill {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(
        90deg,
        var(--gp-progress-tone),
        var(--gp-progress-bright) 54%,
        color-mix(in oklab, var(--gp-progress-tone) 74%, var(--gp-panel))
      );
      box-shadow:
        0 4px 14px var(--gp-glow),
        0 0 22px var(--gp-soft-glow);
      transition: width 650ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    :host([accent="rainbow"]) .overall-fill {
      background: var(--gp-palette-rainbow);
    }

    :host([accent="rainbow"]) .overall-percent {
      background: var(--gp-palette-rainbow);
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      -webkit-text-fill-color: transparent;
    }

    .overall-fill::before {
      position: absolute;
      z-index: 2;
      inset: -60% -20%;
      background: linear-gradient(
        105deg,
        transparent 28%,
        var(--gp-sweep-faint) 38%,
        var(--gp-sweep-soft) 46%,
        var(--gp-sweep-strong) 51%,
        var(--gp-sweep-soft) 58%,
        var(--gp-sweep-faint) 66%,
        transparent 76%
      );
      content: "";
      opacity: 0;
      transform: translateX(-85%);
      animation: overall-sweep 8.6s ease-in-out infinite;
    }

    .particle-field {
      position: absolute;
      z-index: 3;
      inset: 0;
      overflow: hidden;
      border-radius: inherit;
      pointer-events: none;
    }

    .particle {
      position: absolute;
      top: var(--y);
      left: var(--x);
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      background: var(--gp-particle);
      box-shadow:
        0 0 5px var(--gp-particle-glow),
        0 0 9px var(--gp-particle-color-glow);
      opacity: 0;
      animation: particle-drift var(--duration) linear infinite;
      animation-delay: var(--delay);
      pointer-events: none;
      will-change: transform, opacity;
    }

    .frontier,
    .mini-frontier {
      position: absolute;
      z-index: 5;
      top: 50%;
      left: var(--progress);
      width: ${GLASS_LENSES.overall.width}px;
      height: ${GLASS_LENSES.overall.height}px;
      border: 1px solid color-mix(in srgb, var(--gp-accent) 46%, var(--gp-glass-edge));
      border-radius: 999px;
      background-color: var(--gp-handle-surface);
      background-image: var(--gp-handle-sheen);
      -webkit-backdrop-filter: var(--gp-handle-filter, url(#gp-progress-refraction));
      backdrop-filter: var(--gp-handle-filter, url(#gp-progress-refraction));
      box-shadow: var(--gp-handle-shadow);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .mini-frontier {
      width: ${GLASS_LENSES.mini.width}px;
      height: ${GLASS_LENSES.mini.height}px;
      left: clamp(${GLASS_LENSES.mini.width / 2}px, var(--progress), calc(100% - ${GLASS_LENSES.mini.width / 2}px));
      -webkit-backdrop-filter: var(--gp-handle-filter, url(#gp-mini-progress-refraction));
      backdrop-filter: var(--gp-handle-filter, url(#gp-mini-progress-refraction));
    }

    .sparkle-field {
      position: absolute;
      inset: 0 auto 0 0;
      overflow: visible;
      pointer-events: none;
    }

    .sparkle {
      position: absolute;
      top: var(--y);
      left: var(--x);
      width: var(--size);
      height: var(--size);
      border-radius: 50%;
      background: var(--gp-sparkle);
      box-shadow:
        0 0 6px var(--gp-sparkle-glow),
        0 0 12px var(--gp-sparkle-color-glow);
      opacity: 0;
      animation: sparkle-twinkle var(--duration) ease-in-out infinite;
      animation-delay: var(--delay);
    }

    .sparkle::after {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 1px;
      height: 8px;
      background: linear-gradient(transparent, var(--gp-sparkle-ray), transparent);
      content: "";
      transform: translate(-50%, -50%);
    }

`;
