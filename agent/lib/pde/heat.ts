import {
  applyBoundary,
  createGrid,
  interiorVector,
  laplacianInterior,
  sampleFull,
  sampleInterior,
  toRows,
  writeInterior,
  type Grid,
} from "./grid.ts";
import { conjugateGradient, thomas } from "./linalg.ts";
import type { Problem } from "./problem.ts";
import { captureSnapshots, planTime, type TimePlan } from "./time.ts";
import type { SolutionFrame } from "./types.ts";

export interface HeatSolve {
  grid: Grid;
  frames: SolutionFrame[];
  plan: TimePlan;
  iterations: number | null;
  residual: number | null;
  method: { name: string; accuracy: string; summary: string };
}

export function solveHeat(problem: Problem): HeatSolve {
  const grid = createGrid(problem.dimension, problem.x0, problem.x1, problem.nx, problem.y0, problem.y1, problem.ny);
  const plan = planTime({
    tEnd: problem.tEnd!,
    dt: problem.dt,
    nt: problem.nt,
    policy: problem.dtPolicy,
  });
  const initial = sampleFull(grid, 0, problem.initial!);
  applyBoundary(initial, grid, 0, problem.boundary);

  if (problem.dimension === 1) {
    const frames = captureSnapshots({
      tEnd: problem.tEnd!,
      dt: plan.dt,
      steps: plan.steps,
      count: problem.snapshots,
      initial,
      advance: (field, t, dt) => heatStep1d(field, t, dt, problem, grid),
    });
    return {
      grid,
      plan,
      frames: frames.map((frame) => ({ t: frame.t, values: toRows(frame.values, grid) })),
      iterations: null,
      residual: null,
      method: {
        name: "crank-nicolson",
        accuracy: "时间二阶、空间二阶",
        summary:
          "一维热方程 u_t = α u_xx + f 用 Crank–Nicolson 格式：时间上对当前层和下一层取平均，空间上用二阶中心差分。每个时间步用 Thomas 算法求解三对角方程组。格式无条件稳定。",
      },
    };
  }

  let iterations = 0;
  let residual = 0;
  const frames = captureSnapshots({
    tEnd: problem.tEnd!,
    dt: plan.dt,
    steps: plan.steps,
    count: problem.snapshots,
    initial,
    advance: (field, t, dt) => {
      const stepped = heatStep2d(field, t, dt, problem, grid);
      iterations += stepped.iterations;
      residual = Math.max(residual, stepped.residual);
      return stepped.field;
    },
  });
  return {
    grid,
    plan,
    frames: frames.map((frame) => ({ t: frame.t, values: toRows(frame.values, grid) })),
    iterations,
    residual,
    method: {
      name: "crank-nicolson-conjugate-gradient",
      accuracy: "时间二阶、空间二阶",
      summary:
        "二维热方程 u_t = α Δu + f 用 Crank–Nicolson 格式配合五点差分。每个时间步的线性方程组对称正定，用共轭梯度法求解。格式无条件稳定。",
    },
  };
}

function heatStep1d(field: Float64Array, t: number, dt: number, problem: Problem, grid: Grid): Float64Array {
  const n = grid.nx - 2;
  const lambda = (problem.alpha * dt) / (2 * grid.hx * grid.hx);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  const nextT = t + dt;
  for (let k = 0; k < n; k += 1) {
    const i = k + 1;
    const x = grid.x[i];
    a[k] = -lambda;
    b[k] = 1 + 2 * lambda;
    c[k] = -lambda;
    const forcing = problem.source(x, 0, t) + problem.source(x, 0, nextT);
    d[k] = (1 - 2 * lambda) * field[i] + lambda * (field[i - 1] + field[i + 1]) + (dt / 2) * forcing;
  }
  const left = problem.boundary.left(grid.x0, 0, nextT);
  const right = problem.boundary.right(grid.x1, 0, nextT);
  d[0] -= a[0] * left;
  d[n - 1] -= c[n - 1] * right;
  a[0] = 0;
  c[n - 1] = 0;
  const interior = thomas(a, b, c, d);
  const next = new Float64Array(grid.nx);
  for (let k = 0; k < n; k += 1) next[k + 1] = interior[k];
  next[0] = left;
  next[grid.nx - 1] = right;
  return next;
}

function heatStep2d(
  field: Float64Array,
  t: number,
  dt: number,
  problem: Problem,
  grid: Grid,
): { field: Float64Array; iterations: number; residual: number } {
  const n = (grid.nx - 2) * (grid.ny - 2);
  const factor = (problem.alpha * dt) / 2;
  const current = interiorVector(field, grid);
  const laplacianNow = laplacianInterior(field, grid);
  const boundaryOnly = new Float64Array(grid.nx * grid.ny);
  applyBoundary(boundaryOnly, grid, t + dt, problem.boundary);
  const laplacianBoundary = laplacianInterior(boundaryOnly, grid);
  const forceNow = sampleInterior(grid, t, problem.source);
  const forceNext = sampleInterior(grid, t + dt, problem.source);
  const rhs = new Float64Array(n);
  for (let index = 0; index < n; index += 1) {
    rhs[index] =
      current[index] +
      factor * (laplacianNow[index] + laplacianBoundary[index]) +
      (dt / 2) * (forceNow[index] + forceNext[index]);
  }

  const scratch = new Float64Array(grid.nx * grid.ny);
  const solved = conjugateGradient(
    (candidate, out) => {
      scratch.fill(0);
      writeInterior(scratch, candidate, grid);
      const laplacian = laplacianInterior(scratch, grid);
      for (let index = 0; index < n; index += 1) out[index] = candidate[index] - factor * laplacian[index];
    },
    rhs,
    current.slice(),
    1e-10,
    Math.max(800, n),
  );

  writeInterior(boundaryOnly, solved.x, grid);
  return { field: boundaryOnly, iterations: solved.iterations, residual: solved.residual };
}
