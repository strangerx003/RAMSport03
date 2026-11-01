/** Component-level reliability arithmetic shared by RBD and FTA. */

export type ReliabilityInput = { lambda: number; mttr: number };

export function componentAvailability({ lambda, mttr }: ReliabilityInput) {
  return lambda > 0 ? 1 / (1 + lambda * Math.max(0, mttr)) : 1;
}

export function componentAvailabilityPercent(input: ReliabilityInput) {
  return `${(componentAvailability(input) * 100).toFixed(5)}%`;
}

export function meanTimeBetweenFailures(lambda: number) {
  return lambda > 0 ? 1 / lambda : 0;
}

/** Mission reliability R(t) = exp(-λt). Returns 1 for a zero rate. */
export function missionReliability(lambda: number, missionHours: number) {
  if (!(lambda > 0)) return 1;
  return Math.exp(-lambda * Math.max(0, missionHours));
}

export function failuresInTime(lambda: number) {
  return Math.max(0, lambda) * 1e9;
}

export function seriesAvailability(inputs: ReliabilityInput[]) {
  return inputs.reduce((result, input) => result * componentAvailability(input), 1);
}
