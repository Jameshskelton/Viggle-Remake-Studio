import type { MaskMargin } from "./types.ts";

// `expand` and `blur` are pixels at the mask's working resolution (up to 1008 px on the long edge).
// `headroom` is a fraction of the tracked person's height above their head.
export const MASK_MARGINS: Record<MaskMargin, { label: string; headroom: number; expand: number; blur: number }> = {
  tight: { label: "Tight", headroom: 0.12, expand: 16, blur: 4 },
  normal: { label: "Normal", headroom: 0.18, expand: 40, blur: 6 },
  loose: { label: "Loose", headroom: 0.24, expand: 72, blur: 8 },
};

export const DEFAULT_MASK_MARGIN: MaskMargin = "loose";
