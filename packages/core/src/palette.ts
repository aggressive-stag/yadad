// The colour palette of the components set's select, reference and board-column
// colour dots. A colour outside it paints nothing, so the validator flags it.

/** One palette colour; the colour slot is its index in `COLOR_PALETTE`. */
export interface PaletteColor {
  readonly hex: string;
  readonly name: string;
}

/** The eight palette colours, in slot order (slot = index). Hex is lowercase `#rrggbb`. */
export const COLOR_PALETTE: readonly PaletteColor[] = [
  { hex: "#464ea9", name: "blue" },
  { hex: "#d13438", name: "red" },
  { hex: "#f7630c", name: "orange" },
  { hex: "#ffb900", name: "yellow" },
  { hex: "#107c10", name: "green" },
  { hex: "#038387", name: "teal" },
  { hex: "#8764b8", name: "purple" },
  { hex: "#c239b3", name: "pink" },
];

/** Whether `hex` is a palette colour (case-insensitive). */
export function isPaletteColor(hex: string): boolean {
  const lower = hex.toLowerCase();
  return COLOR_PALETTE.some((c) => c.hex === lower);
}
