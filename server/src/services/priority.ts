export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH';
export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';

export interface PriorityResult {
  level: PriorityLevel;
  score: number;
  factors: string[];
}

const URGENCY_VALUE: Record<Urgency, number> = { LOW: 1, MEDIUM: 2, HIGH: 3 };

export function impactFromAffected(affected: number): number {
  if (affected <= 5) return 1;
  if (affected <= 20) return 2;
  return 3;
}

/** Deterministic rule from brief section 6.3. */
export function computePriority(input: {
  urgency: Urgency;
  affectedCount: number;
  hazard: boolean;
}): PriorityResult {
  const u = URGENCY_VALUE[input.urgency];
  const impact = impactFromAffected(input.affectedCount);
  const hazardPoints = input.hazard ? 5 : 0;
  const score = 2 * u + impact + hazardPoints;

  let level: PriorityLevel;
  if (input.hazard || score >= 11) level = 'P1';
  else if (score >= 8) level = 'P2';
  else if (score >= 5) level = 'P3';
  else level = 'P4';

  const factors = [
    `Urgency ${input.urgency} = ${u} (×2 = ${2 * u})`,
    `Impact for ${input.affectedCount} affected = ${impact}`,
    input.hazard ? 'Safety hazard flagged: +5 and forces P1' : 'No safety hazard flagged: +0',
    `Score ${score} → ${level}`,
  ];
  return { level, score, factors };
}
