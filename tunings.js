// MIDI numbers, string 6 (thickest) to string 1
export const TUNINGS = [
  { id: 'standard', name: 'Standard', midi: [40, 45, 50, 55, 59, 64] },
  { id: 'dropd', name: 'Drop D', midi: [38, 45, 50, 55, 59, 64] },
  { id: 'halfdown', name: 'Pół tonu niżej', midi: [39, 44, 49, 54, 58, 63] },
  { id: 'dstd', name: 'Cały ton niżej', midi: [38, 43, 48, 53, 57, 62] },
  { id: 'dropc', name: 'Drop C', midi: [36, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'DADGAD', midi: [38, 45, 50, 55, 57, 62] },
  { id: 'openg', name: 'Open G', midi: [38, 43, 50, 55, 59, 62] },
  { id: 'opend', name: 'Open D', midi: [38, 45, 50, 54, 57, 62] },
  { id: 'opene', name: 'Open E', midi: [40, 47, 52, 56, 59, 64] },
];

export const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
