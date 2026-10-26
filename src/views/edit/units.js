// Unit handling for rulers, guides, margins and the numeric position fields.
// All document geometry is stored in PDF points (1/72 in); units are display-only.
export const UNIT_DEFS = {
  in: { label: 'in', name: 'Inches', pt: 72, digits: 2 },
  mm: { label: 'mm', name: 'Millimeters', pt: 72 / 25.4, digits: 1 },
  cm: { label: 'cm', name: 'Centimeters', pt: 72 / 2.54, digits: 2 },
  pt: { label: 'pt', name: 'Points', pt: 1, digits: 1 },
};

export const toUnit = (pt, unit) => pt / (UNIT_DEFS[unit]?.pt || 1);
export const fromUnit = (value, unit) => value * (UNIT_DEFS[unit]?.pt || 1);

export function formatUnit(pt, unit, withLabel = false) {
  const def = UNIT_DEFS[unit] || UNIT_DEFS.pt;
  const text = String(Number(toUnit(pt, unit).toFixed(def.digits)));
  return withLabel ? `${text} ${def.label}` : text;
}

const NICE = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

/** Choose ruler tick spacing (in points) for the current zoom. */
export function rulerSteps(unit, pxPerPt) {
  const unitPt = UNIT_DEFS[unit]?.pt || 1;
  const pxPerUnit = pxPerPt * unitPt;
  const major = NICE.find((n) => n * pxPerUnit >= 64) || 5000;
  const mantissa = major / 10 ** Math.floor(Math.log10(major));
  let sub = 5;
  if (Math.abs(mantissa - 1) < 1e-9) sub = 10;
  else if (Math.abs(mantissa - 2) < 1e-9) sub = 4;
  if ((major / sub) * pxPerUnit < 5) sub = 1;
  return { majorPt: major * unitPt, minorPt: (major / sub) * unitPt, sub, major };
}
