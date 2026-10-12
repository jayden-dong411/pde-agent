import type { ScalarField } from "./expression.ts";
import { PdeError } from "./errors.ts";
import { idx, type Grid } from "./grid.ts";

export interface SideCondition {
  kind: "dirichlet" | "neumann" | "robin";
  /** Dirichlet value, or the outward-flux data g in ∂u/∂n + σ u = g. */
  value: ScalarField;
  sigma: ScalarField;
}

export interface SideSet {
  left: SideCondition;
  right: SideCondition;
  bottom: SideCondition;
  top: SideCondition;
}

export interface UnknownLayout {
  count: number;
  /** Grid index to unknown index, or -1 when the node is fixed by Dirichlet. */
  unknownAt: Int32Array;
  points: Array<{ i: number; j: number }>;
}

const KIND_NAME = {
  dirichlet: "Dirichlet",
  neumann: "Neumann",
  robin: "Robin",
} as const;

export function allDirichlet(sides: SideSet, dimension: 1 | 2): boolean {
  return activeSides(sides, dimension).every((side) => side.kind === "dirichlet");
}

export function isPureNeumann(sides: SideSet, dimension: 1 | 2): boolean {
  return activeSides(sides, dimension).every((side) => side.kind === "neumann");
}

export function describeSides(sides: SideSet, dimension: 1 | 2): string {
  const parts = [`左 ${KIND_NAME[sides.left.kind]}`, `右 ${KIND_NAME[sides.right.kind]}`];
  if (dimension === 2) {
    parts.push(`下 ${KIND_NAME[sides.bottom.kind]}`, `上 ${KIND_NAME[sides.top.kind]}`);
  }
  return parts.join("，");
}

export function buildLayout(grid: Grid, sides: SideSet): UnknownLayout {
  const unknownAt = new Int32Array(grid.nx * grid.ny);
  unknownAt.fill(-1);
  const points: Array<{ i: number; j: number }> = [];
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      if (isDirichletNode(i, j, grid, sides)) continue;
      unknownAt[idx(i, j, grid.nx)] = points.length;
      points.push({ i, j });
    }
  }
  if (points.length === 0) {
    throw new PdeError("边界条件把所有节点都固定了，没有可求解的未知量。");
  }
  return { count: points.length, unknownAt, points };
}

export function paintDirichlet(field: Float64Array, grid: Grid, t: number, sides: SideSet): void {
  if (sides.left.kind === "dirichlet") {
    for (let j = 0; j < grid.ny; j += 1) {
      field[idx(0, j, grid.nx)] = sides.left.value(grid.x0, grid.y[j], t);
    }
  }
  if (sides.right.kind === "dirichlet") {
    for (let j = 0; j < grid.ny; j += 1) {
      field[idx(grid.nx - 1, j, grid.nx)] = sides.right.value(grid.x1, grid.y[j], t);
    }
  }
  if (grid.dimension === 1) return;
  if (sides.bottom.kind === "dirichlet") {
    for (let i = 0; i < grid.nx; i += 1) {
      if (dirichletOwnsVerticalCorner(i, grid, sides)) continue;
      field[idx(i, 0, grid.nx)] = sides.bottom.value(grid.x[i], grid.y0, t);
    }
  }
  if (sides.top.kind === "dirichlet") {
    for (let i = 0; i < grid.nx; i += 1) {
      if (dirichletOwnsVerticalCorner(i, grid, sides)) continue;
      field[idx(i, grid.ny - 1, grid.nx)] = sides.top.value(grid.x[i], grid.y1, t);
    }
  }
}

/** Pointwise discrete Laplacian, with second-order outward ghosts on Neumann and Robin nodes. */
export function laplacianAt(
  field: Float64Array,
  grid: Grid,
  i: number,
  j: number,
  t: number,
  useFlux: boolean,
  sides: SideSet,
): number {
  const dxx = secondDerivative(field, grid, i, j, t, useFlux, sides, "x");
  if (grid.dimension === 1) return dxx;
  return dxx + secondDerivative(field, grid, i, j, t, useFlux, sides, "y");
}

export function symmetryWeight(grid: Grid, i: number, j: number): number {
  if (grid.dimension === 1) return i === 0 || i === grid.nx - 1 ? 0.5 : 1;
  const onX = i === 0 || i === grid.nx - 1;
  const onY = j === 0 || j === grid.ny - 1;
  if (onX && onY) return 0.25;
  if (onX || onY) return 0.5;
  return 1;
}

function activeSides(sides: SideSet, dimension: 1 | 2): SideCondition[] {
  return dimension === 1 ? [sides.left, sides.right] : [sides.left, sides.right, sides.bottom, sides.top];
}

function isDirichletNode(i: number, j: number, grid: Grid, sides: SideSet): boolean {
  if (i === 0 && sides.left.kind === "dirichlet") return true;
  if (i === grid.nx - 1 && sides.right.kind === "dirichlet") return true;
  if (grid.dimension === 2 && j === 0 && sides.bottom.kind === "dirichlet") return true;
  if (grid.dimension === 2 && j === grid.ny - 1 && sides.top.kind === "dirichlet") return true;
  return false;
}

function dirichletOwnsVerticalCorner(i: number, grid: Grid, sides: SideSet): boolean {
  return (i === 0 && sides.left.kind === "dirichlet") || (i === grid.nx - 1 && sides.right.kind === "dirichlet");
}

function secondDerivative(
  field: Float64Array,
  grid: Grid,
  i: number,
  j: number,
  t: number,
  useFlux: boolean,
  sides: SideSet,
  axis: "x" | "y",
): number {
  const h = axis === "x" ? grid.hx : grid.hy;
  const di = axis === "x" ? 1 : 0;
  const dj = axis === "x" ? 0 : 1;
  const center = field[idx(i, j, grid.nx)];
  const plus = sample(field, grid, i + di, j + dj, i, j, t, useFlux, sides);
  const minus = sample(field, grid, i - di, j - dj, i, j, t, useFlux, sides);
  return (minus - 2 * center + plus) / (h * h);
}

function sample(
  field: Float64Array,
  grid: Grid,
  ii: number,
  jj: number,
  originI: number,
  originJ: number,
  t: number,
  useFlux: boolean,
  sides: SideSet,
): number {
  if (ii >= 0 && ii < grid.nx && jj >= 0 && jj < grid.ny) return field[idx(ii, jj, grid.nx)];
  const outwardI = Math.sign(ii - originI);
  const outwardJ = Math.sign(jj - originJ);
  const boundaryI = outwardI === 0 ? originI : outwardI < 0 ? 0 : grid.nx - 1;
  const boundaryJ = outwardJ === 0 ? originJ : outwardJ < 0 ? 0 : grid.ny - 1;
  return ghost(field, grid, boundaryI, boundaryJ, outwardI, outwardJ, t, useFlux, sides);
}

function ghost(
  field: Float64Array,
  grid: Grid,
  boundaryI: number,
  boundaryJ: number,
  outwardI: number,
  outwardJ: number,
  t: number,
  useFlux: boolean,
  sides: SideSet,
): number {
  const side =
    outwardI === -1 ? sides.left : outwardI === 1 ? sides.right : outwardJ === -1 ? sides.bottom : sides.top;
  if (side.kind === "dirichlet") {
    throw new PdeError("内部离散试图穿过 Dirichlet 边界构造虚点。");
  }
  const h = outwardI !== 0 ? grid.hx : grid.hy;
  const x = grid.x[boundaryI];
  const y = grid.y[boundaryJ];
  const sigma = side.kind === "robin" ? side.sigma(x, y, t) : 0;
  const flux = useFlux ? side.value(x, y, t) : 0;
  const inward = field[idx(boundaryI - outwardI, boundaryJ - outwardJ, grid.nx)];
  const boundaryValue = field[idx(boundaryI, boundaryJ, grid.nx)];
  return inward + 2 * h * (flux - sigma * boundaryValue);
}
