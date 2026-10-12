import {
  applyBoundary,
  createGrid,
  laplacianInterior,
  sampleInterior,
  toRows,
  writeInterior,
  type Grid,
} from "./grid.ts";
import { conjugateGradient, thomas } from "./linalg.ts";
import type { Problem } from "./problem.ts";
import type { SolutionFrame } from "./types.ts";

export interface PoissonSolve {
  grid: Grid;
  frames: SolutionFrame[];
  iterations: number | null;
  residual: number | null;
  method: { name: string; accuracy: string; summary: string };
}

export function solvePoisson(problem: Problem): PoissonSolve {
  const grid = createGrid(problem.dimension, problem.x0, problem.x1, problem.nx, problem.y0, problem.y1, problem.ny);
  if (problem.dimension === 1) {
    return { grid, ...solvePoisson1d(problem, grid) };
  }
  return { grid, ...solvePoisson2d(problem, grid) };
}

function solvePoisson1d(problem: Problem, grid: Grid): Omit<PoissonSolve, "grid"> {
  const n = grid.nx - 2;
  const invH2 = 1 / (grid.hx * grid.hx);
  const a = new Float64Array(n);
  const b = new Float64Array(n);
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  for (let k = 0; k < n; k += 1) {
    const x = grid.x[k + 1];
    a[k] = -invH2;
    b[k] = 2 * invH2;
    c[k] = -invH2;
    d[k] = problem.source(x, 0, 0);
  }
  const left = problem.boundary.left(grid.x0, 0, 0);
  const right = problem.boundary.right(grid.x1, 0, 0);
  d[0] -= a[0] * left;
  d[n - 1] -= c[n - 1] * right;
  a[0] = 0;
  c[n - 1] = 0;
  const interior = thomas(a, b, c, d);
  const field = new Float64Array(grid.nx);
  for (let k = 0; k < n; k += 1) field[k + 1] = interior[k];
  field[0] = left;
  field[grid.nx - 1] = right;

  let residual = 0;
  for (let i = 1; i < grid.nx - 1; i += 1) {
    const discrete = -((field[i - 1] - 2 * field[i] + field[i + 1]) * invH2);
    residual = Math.max(residual, Math.abs(discrete - problem.source(grid.x[i], 0, 0)));
  }

  return {
    frames: [{ t: null, values: toRows(field, grid) }],
    iterations: null,
    residual,
    method: {
      name: "thomas-second-order",
      accuracy: "空间二阶",
      summary:
        "一维 Poisson 方程 −u'' = f 用二阶中心差分离散，内部节点构成三对角线性方程组，再用 Thomas 算法直接求解。两端是 Dirichlet 边界。",
    },
  };
}

function solvePoisson2d(problem: Problem, grid: Grid): Omit<PoissonSolve, "grid"> {
  const nxi = grid.nx - 2;
  const n = nxi * (grid.ny - 2);
  const forcing = sampleInterior(grid, 0, problem.source);
  const boundaryOnly = new Float64Array(grid.nx * grid.ny);
  applyBoundary(boundaryOnly, grid, 0, problem.boundary);
  const boundaryLaplacian = laplacianInterior(boundaryOnly, grid);
  const rhs = new Float64Array(n);
  for (let index = 0; index < n; index += 1) rhs[index] = forcing[index] + boundaryLaplacian[index];

  const scratch = new Float64Array(grid.nx * grid.ny);
  const solved = conjugateGradient(
    (candidate, out) => {
      scratch.fill(0);
      writeInterior(scratch, candidate, grid);
      const laplacian = laplacianInterior(scratch, grid);
      for (let index = 0; index < n; index += 1) out[index] = -laplacian[index];
    },
    rhs,
    new Float64Array(n),
    1e-12,
    Math.max(800, n),
  );

  const field = boundaryOnly;
  writeInterior(field, solved.x, grid);
  return {
    frames: [{ t: null, values: toRows(field, grid) }],
    iterations: solved.iterations,
    residual: solved.residual,
    method: {
      name: "five-point-conjugate-gradient",
      accuracy: "空间二阶",
      summary:
        "二维 Poisson 方程 −Δu = f 用五点二阶中心差分离散。离散算子对称正定，使用不组装矩阵的共轭梯度法求解。四条边都是 Dirichlet 边界。",
    },
  };
}
