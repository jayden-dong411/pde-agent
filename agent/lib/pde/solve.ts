import { allDirichlet, isPureNeumann } from "./boundary.ts";
import { PdeError } from "./errors.ts";
import { explain } from "./explain.ts";
import { solveGeneral } from "./general.ts";
import { assertFinite, fieldStats } from "./grid.ts";
import { solveHeat } from "./heat.ts";
import { solvePoisson } from "./poisson.ts";
import { normalizeProblem } from "./problem.ts";
import type { SolveInput, SolveResult } from "./types.ts";
import { solveWave } from "./wave.ts";

export type { SolveInput, SolveResult } from "./types.ts";

/**
 * Solve a constant-coefficient linear PDE on an interval or a rectangle.
 *
 * Poisson:  −Δu = f
 * Heat:     u_t = α Δu + f
 * Wave:     u_tt = c² Δu + f
 *
 * Dirichlet sides fix the value. Neumann and Robin sides prescribe the outward
 * derivative, ∂u/∂n + σ u = g, with σ = 0 for Neumann.
 * One-dimensional problems omit the y direction.
 */
export function solvePde(input: SolveInput): SolveResult {
  const problem = normalizeProblem(input);
  if (
    problem.normalization &&
    !(problem.equation === "poisson" && isPureNeumann(problem.sides, problem.dimension))
  ) {
    throw new PdeError(
      "normalization 只用于两端或四边都是 Neumann 的 Poisson 方程。其他边界条件下常数已经被定住了。",
    );
  }
  const solved = allDirichlet(problem.sides, problem.dimension)
    ? problem.equation === "poisson"
      ? solvePoisson(problem)
      : problem.equation === "heat"
        ? solveHeat(problem)
        : solveWave(problem)
    : solveGeneral(problem);
  const final = solved.frames[solved.frames.length - 1];
  if (!final) {
    throw new Error("求解器没有返回解场。");
  }
  for (const row of final.values) assertFinite("解", row);
  const stats = fieldStats(final.values);
  const plan = "plan" in solved ? solved.plan : null;
  const iterations = "iterations" in solved ? solved.iterations : null;
  const residual = "residual" in solved ? solved.residual : null;
  const result: Omit<SolveResult, "explanation"> = {
    equation: problem.equation,
    dimension: problem.dimension,
    method: solved.method,
    domain: {
      x: [problem.x0, problem.x1],
      ...(problem.dimension === 2 ? { y: [problem.y0, problem.y1] as [number, number] } : {}),
    },
    coefficients: {
      alpha: problem.equation === "heat" ? problem.alpha : null,
      waveSpeed: problem.equation === "wave" ? problem.waveSpeed : null,
    },
    grid: {
      x: Array.from(solved.grid.x),
      ...(problem.dimension === 2 ? { y: Array.from(solved.grid.y) } : {}),
      hx: solved.grid.hx,
      hy: problem.dimension === 2 ? solved.grid.hy : null,
    },
    frames: solved.frames,
    layout: "values[yIndex][xIndex]；一维问题只有一行。frames 的最后一帧是所求解。",
    diagnostics: {
      min: stats.min,
      max: stats.max,
      mean: stats.mean,
      steps: plan?.steps ?? null,
      dt: plan?.dt ?? null,
      dtRequested: plan?.dtRequested ?? null,
      dtAdjusted: plan?.adjusted ?? false,
      cfl: plan?.cfl ?? null,
      cflLimit: plan?.cflLimit ?? null,
      iterations,
      residual,
    },
    ignoredCoefficients: problem.ignoredCoefficients,
  };
  return { ...result, explanation: explain(result) };
}
