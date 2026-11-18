import * as fa6 from "./fa6.js";
import * as fi from "./fi.js";

export const allowedPickerIcons: ReadonlySet<string> = new Set([...Object.keys(fa6), ...Object.keys(fi)]);

/** Picker icon names look like `FaPhone` / `FiCheck`; built-in names (`phone`) need no set. */
export function isPickerIconName(name: string): boolean {
  return /^(Fa|Fi)[A-Z0-9]/.test(name);
}
