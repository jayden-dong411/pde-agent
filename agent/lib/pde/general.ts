import {
  buildLayout,
  describeSides,
  isPureNeumann,
  laplacianAt,
  paintDirichlet,
  symmetryWeight,
  type SideSet,
  type UnknownLayout,
} from "./boundary.ts";
import { PdeError } from "./errors.ts";
import { createGrid, idx, sampleFull, toRows, type Grid } from "./grid.ts";
import { conjugateGradient, dot, thomas } from "./linalg.ts";
import type { Problem } from "./problem.ts";
import { captureSnapshots, planTime, type TimePlan } from "./time.ts";
import type { SolutionFrame } from "./types.ts";

export interface GeneralSolve {
  grid: Grid;
  frames: SolutionFrame[];
  method: { name: string; accuracy: string; summary: string };
  plan: TimePlan | null;
  iterations: number | null;
  residual: number | null;
}

interface LinearOperator {
  apply: (vector: Float64Array, out: Float64Array) => void;
}

export function solveGeneral(problem: Problem): GeneralSolve {
  const grid = createGrid(problem.dimension, problem.x0, problem.x1, problem.nx, problem.y0, problem.y1, problem.ny);
  const sides = problem.sides;
  const layout = buildLayout(grid, sides);
  const pureNeumann = problem.equation === "poisson" && isPureNeumann(sides, problem.dimension);
  if (problem.normalization && !pureNeumann) {
    throw new PdeError("normalization 只用于四边（或两端）都是 Neumann 的 Poisson 方程。这个常数平移在其他边界条件下会改变方程。");
  }
  if (problem.equation === "poisson") {
    return solveGeneralPoisson(problem, grid, sides, layout, pureNeumann);
  }
  if (problem.equation === "heat") return solveGeneralHeat(problem, grid, sides, layout);
  return solveGeneralWave(problem, grid, sides, layout);
}

function solveGeneralPoisson(
  problem: Problem,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
  pureNeumann: boolean,
): GeneralSolve {
  const rhs = poissonRhs(problem, grid, sides, layout, 0);
  const operator = poissonOperator(grid, sides, layout);
  const solved = pureNeumann
    ? solveSingular(operator.apply, rhs, grid, layout, problem.normalization)
    : solveDefinite(operator.apply, rhs, grid, layout);
  const field = fieldFromUnknowns(solved.x, grid, sides, layout, 0);
  return {
    grid,
    frames: [{ t: null, values: toRows(field, grid) }],
    plan: null,
    iterations: solved.iterations,
    residual: maxPdeResidual(field, grid, sides, layout, 0, problem.source),
    method: method(problem, grid, sides, pureNeumann, solved.note),
  };
}

function solveGeneralHeat(problem: Problem, grid: Grid, sides: SideSet, layout: UnknownLayout): GeneralSolve {
  const plan = planTime({
    tEnd: problem.tEnd!,
    dt: problem.dt,
    nt: problem.nt,
    policy: problem.dtPolicy,
  });
  const initial = sampleFull(grid, 0, problem.initial!);
  paintDirichlet(initial, grid, 0, sides);
  let iterations: number | null = null;
  let residual: number | null = null;
  const frames = captureSnapshots({
    tEnd: problem.tEnd!,
    dt: plan.dt,
    steps: plan.steps,
    count: problem.snapshots,
    initial,
    advance: (field, t, dt) => {
      const stepped = heatStep(field, t, dt, problem, grid, sides, layout);
      if (stepped.iterations !== null) iterations = (iterations ?? 0) + stepped.iterations;
      if (stepped.residual !== null) residual = Math.max(residual ?? 0, stepped.residual);
      return stepped.field;
    },
  });
  return {
    grid,
    plan,
    frames: frames.map((frame) => ({ t: frame.t, values: toRows(frame.values, grid) })),
    iterations,
    residual,
    method: method(problem, grid, sides, false, null),
  };
}

function solveGeneralWave(problem: Problem, grid: Grid, sides: SideSet, layout: UnknownLayout): GeneralSolve {
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
  paintDirichlet(initial, grid, 0, sides);
  let previous: Float64Array | null = null;
  const frames = captureSnapshots({
    tEnd: problem.tEnd!,
    dt: plan.dt,
    steps: plan.steps,
    count: problem.snapshots,
    initial,
    advance: (field, t, dt) => {
      const next = previous === null
        ? waveFirst(field, t, dt, problem, grid, sides, layout)
        : waveLeap(previous, field, t, dt, problem, grid, sides, layout);
      previous = field;
      return next;
    },
  });
  return {
    grid,
    plan,
    frames: frames.map((frame) => ({ t: frame.t, values: toRows(frame.values, grid) })),
    iterations: null,
    residual: null,
    method: method(problem, grid, sides, false, null),
  };
}

function poissonOperator(grid: Grid, sides: SideSet, layout: UnknownLayout): LinearOperator {
  return {
    apply(vector, out) {
      const field = fieldFromUnknowns(vector, grid, sides, layout, null);
      weightedNegativeLaplacian(field, grid, sides, layout, 0, false, out);
    },
  };
}

function poissonRhs(problem: Problem, grid: Grid, sides: SideSet, layout: UnknownLayout, t: number): Float64Array {
  const rhs = new Float64Array(layout.count);
  const flux = new Float64Array(layout.count);
  const dirichlet = new Float64Array(grid.nx * grid.ny);
  paintDirichlet(dirichlet, grid, t, sides);
  weightedNegativeLaplacian(dirichlet, grid, sides, layout, t, true, flux);
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    rhs[k] = symmetryWeight(grid, i, j) * problem.source(grid.x[i], grid.y[j], t) - flux[k];
  }
  return rhs;
}

function heatStep(
  field: Float64Array,
  t: number,
  dt: number,
  problem: Problem,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
): { field: Float64Array; iterations: number | null; residual: number | null } {
  const nextT = t + dt;
  const factor = (problem.alpha * dt) / 2;
  const current = gather(field, layout, grid);
  const rhs = new Float64Array(layout.count);
  const boundaryNext = new Float64Array(grid.nx * grid.ny);
  paintDirichlet(boundaryNext, grid, nextT, sides);
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    const weight = symmetryWeight(grid, i, j);
    const lapOld = laplacianAt(field, grid, i, j, t, true, sides);
    const lapBoundary = laplacianAt(boundaryNext, grid, i, j, nextT, true, sides);
    const forcing = problem.source(grid.x[i], grid.y[j], t) + problem.source(grid.x[i], grid.y[j], nextT);
    rhs[k] = weight * (current[k] + factor * lapOld + factor * lapBoundary + (dt / 2) * forcing);
  }
  const scratch = new Float64Array(grid.nx * grid.ny);
  const spatial = new Float64Array(layout.count);
  const apply = (candidate: Float64Array, out: Float64Array) => {
    scratch.fill(0);
    scatter(scratch, candidate, layout, grid);
    weightedNegativeLaplacian(scratch, grid, sides, layout, nextT, false, spatial);
    for (let k = 0; k < layout.count; k += 1) {
      out[k] = symmetryWeight(grid, layout.points[k].i, layout.points[k].j) * candidate[k] + factor * spatial[k];
    }
  };
  const solved =
    grid.dimension === 1
      ? (() => {
          const x = solveTridiagonal(apply, rhs);
          return { x, iterations: null, residual: residualOf(apply, x, rhs) };
        })()
      : conjugateGradient(apply, rhs, current.slice(), 1e-10, Math.max(800, layout.count));
  const next = boundaryNext;
  scatter(next, solved.x, layout, grid);
  return { field: next, iterations: solved.iterations, residual: solved.residual };
}

function waveFirst(
  field: Float64Array,
  t: number,
  dt: number,
  problem: Problem,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
): Float64Array {
  const next = new Float64Array(field.length);
  const c2 = problem.waveSpeed * problem.waveSpeed;
  const halfDt2 = 0.5 * dt * dt;
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    const position = idx(i, j, grid.nx);
    const lap = laplacianAt(field, grid, i, j, t, true, sides);
    const velocity = problem.velocity(grid.x[i], grid.y[j], t);
    const forcing = problem.source(grid.x[i], grid.y[j], t);
    next[position] = field[position] + dt * velocity + halfDt2 * (c2 * lap + forcing);
  }
  paintDirichlet(next, grid, t + dt, sides);
  return next;
}

function waveLeap(
  previous: Float64Array,
  field: Float64Array,
  t: number,
  dt: number,
  problem: Problem,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
): Float64Array {
  const next = new Float64Array(field.length);
  const c2dt2 = problem.waveSpeed * problem.waveSpeed * dt * dt;
  const dt2 = dt * dt;
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    const position = idx(i, j, grid.nx);
    const lap = laplacianAt(field, grid, i, j, t, true, sides);
    const forcing = problem.source(grid.x[i], grid.y[j], t);
    next[position] = 2 * field[position] - previous[position] + c2dt2 * lap + dt2 * forcing;
  }
  paintDirichlet(next, grid, t + dt, sides);
  return next;
}

function solveDefinite(
  apply: (vector: Float64Array, out: Float64Array) => void,
  rhs: Float64Array,
  grid: Grid,
  layout: UnknownLayout,
): { x: Float64Array; iterations: number | null; residual: number; note: string | null } {
  if (grid.dimension === 1) {
    const solution = solveTridiagonal(apply, rhs);
    return { x: solution, iterations: null, residual: residualOf(apply, solution, rhs), note: null };
  }
  const solved = conjugateGradient(apply, rhs, new Float64Array(layout.count), 1e-12, Math.max(800, layout.count));
  return { x: solved.x, iterations: solved.iterations, residual: solved.residual, note: null };
}

function solveSingular(
  apply: (vector: Float64Array, out: Float64Array) => void,
  rhs: Float64Array,
  grid: Grid,
  layout: UnknownLayout,
  pin: Problem["normalization"],
): { x: Float64Array; iterations: number | null; residual: number; note: string | null } {
  const mean = average(rhs);
  const scale = Math.sqrt(dot(rhs, rhs) / rhs.length) || 1;
  if (Math.abs(mean) > 1e-6 * scale) {
    throw new PdeError(
      "纯 Neumann 的 Poisson 方程不相容：源项和外法向通量的离散积分不为 0。需要 ∫f dV + ∫ ∂u/∂n dS = 0，或把一条边改成 Dirichlet 或 Robin。",
    );
  }
  const projected = rhs.slice();
  removeMean(projected);
  const solved = conjugateGradient(
    (vector, out) => {
      const deflated = vector.slice();
      removeMean(deflated);
      apply(deflated, out);
      removeMean(out);
    },
    projected,
    new Float64Array(layout.count),
    1e-10,
    Math.max(800, layout.count),
  );
  removeMean(solved.x);
  if (!pin) {
    return {
      x: solved.x,
      iterations: solved.iterations,
      residual: solved.residual,
      note: "纯 Neumann 的解相差一个常数，这里把节点平均值平移到了 0。",
    };
  }
  const pinned = nearestUnknown(grid, layout, pin.x, pin.y);
  const shift = pin.value - solved.x[pinned.index];
  for (let k = 0; k < solved.x.length; k += 1) solved.x[k] += shift;
  return {
    x: solved.x,
    iterations: solved.iterations,
    residual: solved.residual,
    note: `纯 Neumann 的解相差一个常数，已平移到 ${formatPin(grid, layout.points[pinned.index])} = ${pin.value}。`,
  };
}

function solveTridiagonal(apply: (vector: Float64Array, out: Float64Array) => void, rhs: Float64Array): Float64Array {
  const n = rhs.length;
  const below = new Float64Array(n);
  const diag = new Float64Array(n);
  const above = new Float64Array(n);
  const probe = new Float64Array(n);
  const column = new Float64Array(n);
  for (let col = 0; col < n; col += 1) {
    probe[col] = 1;
    if (col > 0) probe[col - 1] = 0;
    apply(probe, column);
    diag[col] = column[col];
    if (col + 1 < n) below[col + 1] = column[col + 1];
    if (col > 0) above[col - 1] = column[col - 1];
  }
  return thomas(below, diag, above, rhs);
}

function weightedNegativeLaplacian(
  field: Float64Array,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
  t: number,
  useFlux: boolean,
  out: Float64Array,
): void {
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    out[k] = -symmetryWeight(grid, i, j) * laplacianAt(field, grid, i, j, t, useFlux, sides);
  }
}

function fieldFromUnknowns(
  vector: Float64Array,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
  dirichletTime: number | null,
): Float64Array {
  const field = new Float64Array(grid.nx * grid.ny);
  scatter(field, vector, layout, grid);
  if (dirichletTime !== null) paintDirichlet(field, grid, dirichletTime, sides);
  return field;
}

function scatter(field: Float64Array, vector: Float64Array, layout: UnknownLayout, grid: Grid): void {
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    field[idx(i, j, grid.nx)] = vector[k];
  }
}

function gather(field: Float64Array, layout: UnknownLayout, grid: Grid): Float64Array {
  const vector = new Float64Array(layout.count);
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    vector[k] = field[idx(i, j, grid.nx)];
  }
  return vector;
}

function maxPdeResidual(
  field: Float64Array,
  grid: Grid,
  sides: SideSet,
  layout: UnknownLayout,
  t: number,
  source: Problem["source"],
): number {
  let max = 0;
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    const residual = -laplacianAt(field, grid, i, j, t, true, sides) - source(grid.x[i], grid.y[j], t);
    max = Math.max(max, Math.abs(residual));
  }
  return max;
}

function residualOf(
  apply: (vector: Float64Array, out: Float64Array) => void,
  solution: Float64Array,
  rhs: Float64Array,
): number {
  const image = new Float64Array(solution.length);
  apply(solution, image);
  let max = 0;
  for (let index = 0; index < solution.length; index += 1) {
    max = Math.max(max, Math.abs(image[index] - rhs[index]));
  }
  return max;
}

function removeMean(vector: Float64Array): void {
  const shift = average(vector);
  for (let index = 0; index < vector.length; index += 1) vector[index] -= shift;
}

function average(vector: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < vector.length; index += 1) sum += vector[index];
  return sum / vector.length;
}

function nearestUnknown(
  grid: Grid,
  layout: UnknownLayout,
  x: number | null,
  y: number | null,
): { index: number } {
  const targetX = x ?? grid.x0;
  const targetY = y ?? (grid.dimension === 2 ? grid.y0 : 0);
  if (targetX < grid.x0 - 1e-12 || targetX > grid.x1 + 1e-12) {
    throw new PdeError("normalization.x 必须落在 domain.x 里。");
  }
  if (grid.dimension === 2 && (targetY < grid.y0 - 1e-12 || targetY > grid.y1 + 1e-12)) {
    throw new PdeError("normalization.y 必须落在 domain.y 里。");
  }
  let best = 0;
  let bestDistance = Infinity;
  for (let k = 0; k < layout.count; k += 1) {
    const { i, j } = layout.points[k];
    const dx = grid.x[i] - targetX;
    const dy = grid.y[j] - targetY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = k;
      bestDistance = distance;
    }
  }
  return { index: best };
}

function formatPin(grid: Grid, point: { i: number; j: number }): string {
  if (grid.dimension === 1) return `x = ${grid.x[point.i]}`;
  return `(x, y) = (${grid.x[point.i]}, ${grid.y[point.j]})`;
}

function method(
  problem: Problem,
  grid: Grid,
  sides: SideSet,
  pureNeumann: boolean,
  note: string | null,
): GeneralSolve["method"] {
  const boundaries = describeSides(sides, problem.dimension);
  const solver =
    pureNeumann
      ? "纯 Neumann 的 Poisson 算子有常数零空间，先在均值为零的子空间里做共轭梯度，再按要求平移。"
      : grid.dimension === 1
        ? "一维线性方程组用 Thomas 算法直接求解。"
        : problem.equation === "wave"
          ? "二维波动方程保持显式更新。"
          : "二维线性方程组用共轭梯度法求解。";
  const time =
    problem.equation === "heat"
      ? "时间上用 Crank–Nicolson，边界通量取在对应的时间层。"
      : problem.equation === "wave"
        ? "时间上用二阶中心差分，Neumann 和 Robin 边界跟内部节点一起更新。"
        : "这是定常问题。";
  const summary = `Neumann 与 Robin 用外法向二阶虚点：∂u/∂n + σ u = g，Neumann 时 σ = 0。左端外法向是 −∂/∂x，右端是 ∂/∂x，下边是 −∂/∂y，上边是 ∂/∂y。离散方程按有限体积权重缩放，使算子对称。${solver}${time}本例边界：${boundaries}。${note ?? ""}`;
  return {
    name: pureNeumann ? "finite-volume-pure-neumann" : "finite-volume-mixed-boundary",
    accuracy: problem.equation === "poisson" ? "空间二阶" : "时间二阶、空间二阶",
    summary,
  };
}
