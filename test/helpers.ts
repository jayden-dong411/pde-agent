import { solvePde, type SolveInput, type SolveResult } from "../agent/lib/pde/solve.ts";

export function maxAbsError(
  result: SolveResult,
  exact: (x: number, y: number, t: number) => number,
): number {
  const frame = result.frames[result.frames.length - 1];
  const time = frame.t ?? 0;
  const y = result.grid.y ?? [0];
  let max = 0;
  for (let j = 0; j < frame.values.length; j += 1) {
    for (let i = 0; i < frame.values[j].length; i += 1) {
      const error = Math.abs(frame.values[j][i] - exact(result.grid.x[i], y[j], time));
      if (error > max) max = error;
    }
  }
  return max;
}

export function solve(input: SolveInput): SolveResult {
  return solvePde(input);
}

export const zero = { type: "constant" as const, value: 0 };
export const expr = (expression: string) => ({ type: "expression" as const, expression });
