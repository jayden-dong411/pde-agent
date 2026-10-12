import { applyBoundary, createGrid, idx, sampleFull, toRows, type Grid } from "./grid.ts";
import type { Problem } from "./problem.ts";
import { captureSnapshots, planTime, type TimePlan } from "./time.ts";
import type { SolutionFrame } from "./types.ts";

export interface WaveSolve {
  grid: Grid;
  frames: SolutionFrame[];
  plan: TimePlan;
  method: { name: string; accuracy: string; summary: string };
}

export function solveWave(problem: Problem): WaveSolve {
  const grid = createGrid(problem.dimension, problem.x0, problem.x1, problem.nx, problem.y0, problem.y1, problem.ny);
  const dtMax =
    problem.dimension === 1
      ? grid.hx / problem.waveSpeed
      : 1 / (problem.waveSpeed * Math.sqrt(1 / (grid.hx * grid.hx) + 1 / (grid.hy * grid.hy)));
  const plan = planTime({
    tEnd: problem.tEnd!,
    dt: problem.dt,
    nt: problem.nt,
    dtMax,
    policy: problem.dtPolicy,
  });
  const initial = sampleFull(grid, 0, problem.initial!);
  applyBoundary(initial, grid, 0, problem.boundary);

  let previous: Float64Array | null = null;
  const frames = captureSnapshots({
    tEnd: problem.tEnd!,
    dt: plan.dt,
    steps: plan.steps,
    count: problem.snapshots,
    initial,
    advance: (field, t, dt) => {
      const next =
        previous === null
          ? firstStep(field, t, dt, problem, grid)
          : leapfrog(previous, field, t, dt, problem, grid);
      previous = field;
      return next;
    },
  });

  return {
    grid,
    plan,
    frames: frames.map((frame) => ({ t: frame.t, values: toRows(frame.values, grid) })),
    method:
      problem.dimension === 1
        ? {
            name: "explicit-central-difference",
            accuracy: "时间二阶、空间二阶",
            summary:
              "一维波动方程 u_tt = c² u_xx + f 用时间和空间上的二阶中心差分。初速通过 Taylor 展开进入第一步。格式是显式的，需要满足 CFL 条件 c·Δt/Δx ≤ 1。",
          }
        : {
            name: "explicit-central-difference",
            accuracy: "时间二阶、空间二阶",
            summary:
              "二维波动方程 u_tt = c² Δu + f 用二阶中心差分。稳定性条件是 c·Δt·√(1/Δx² + 1/Δy²) ≤ 1。",
          },
  };
}

function firstStep(field: Float64Array, t: number, dt: number, problem: Problem, grid: Grid): Float64Array {
  const next = new Float64Array(field.length);
  const c2 = problem.waveSpeed * problem.waveSpeed;
  const halfDt2 = 0.5 * dt * dt;
  eachInterior(grid, (i, j, position) => {
    const velocity = problem.velocity(grid.x[i], grid.y[j], t);
    const forcing = problem.source(grid.x[i], grid.y[j], t);
    next[position] = field[position] + dt * velocity + halfDt2 * (c2 * laplacianAt(field, grid, i, j) + forcing);
  });
  applyBoundary(next, grid, t + dt, problem.boundary);
  return next;
}

function leapfrog(
  previous: Float64Array,
  field: Float64Array,
  t: number,
  dt: number,
  problem: Problem,
  grid: Grid,
): Float64Array {
  const next = new Float64Array(field.length);
  const c2dt2 = problem.waveSpeed * problem.waveSpeed * dt * dt;
  const dt2 = dt * dt;
  eachInterior(grid, (i, j, position) => {
    const forcing = problem.source(grid.x[i], grid.y[j], t);
    next[position] = 2 * field[position] - previous[position] + c2dt2 * laplacianAt(field, grid, i, j) + dt2 * forcing;
  });
  applyBoundary(next, grid, t + dt, problem.boundary);
  return next;
}

function eachInterior(grid: Grid, visit: (i: number, j: number, position: number) => void): void {
  for (let j = 0; j < grid.ny; j += 1) {
    if (grid.dimension === 2 && (j === 0 || j === grid.ny - 1)) continue;
    for (let i = 1; i < grid.nx - 1; i += 1) visit(i, j, idx(i, j, grid.nx));
  }
}

function laplacianAt(field: Float64Array, grid: Grid, i: number, j: number): number {
  const center = field[idx(i, j, grid.nx)];
  const dxx = (field[idx(i + 1, j, grid.nx)] - 2 * center + field[idx(i - 1, j, grid.nx)]) / (grid.hx * grid.hx);
  if (grid.dimension === 1) return dxx;
  const dyy = (field[idx(i, j + 1, grid.nx)] - 2 * center + field[idx(i, j - 1, grid.nx)]) / (grid.hy * grid.hy);
  return dxx + dyy;
}
