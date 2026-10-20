const EMERGENCY_TERMS = /\b(fire|smoke|burning|injur(?:y|ed)|bleeding|unconscious|electric shock|live wire|exposed wire|gas leak|explosion|collapse|trapped)\b/i;

export const EMERGENCY_MESSAGE =
  'If anyone is in danger, contact the institution\'s emergency personnel immediately. SmartResolve is a tracking tool, not an emergency dispatch service.';

/** Flags text or hazard checkbox that should show immediate-contact guidance. */
export function needsEmergencyGuidance(text: string, hazardFlag: boolean): boolean {
  return hazardFlag || EMERGENCY_TERMS.test(text);
}
