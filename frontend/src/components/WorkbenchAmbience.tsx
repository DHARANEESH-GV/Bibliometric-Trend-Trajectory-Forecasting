/**
 * WorkbenchAmbience — film grain over the analytical world. A single
 * fixed, pointer-events-none layer (z 30, over content, under the chrome)
 * that breaks the digital flatness of the OLED field so the workbench
 * reads as a physical surface rather than a void.
 *
 * Deliberately grain only: a drifting mesh washed out the data and read
 * as a smear, so atmosphere here is texture, not color. Grain is dropped
 * entirely under reduced transparency.
 */
export function WorkbenchAmbience() {
  return <div className="ambience-grain" aria-hidden />
}
