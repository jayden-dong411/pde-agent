import { PdeError } from "./errors.ts";
import type { ScalarField } from "./expression.ts";

export interface Grid {
  dimension: 1 | 2;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  nx: number;
  ny: number;
  hx: number;
  hy: number;
  x: Float64Array;
  y: Float64Array;
}

export interface BoundaryFns {
  left: ScalarField;
  right: ScalarField;
  bottom: ScalarField;
  top: ScalarField;
}

export function linspace(start: number, end: number, count: number): Float64Array {
  const values = new Float64Array(count);
  if (count === 1) {
    values[0] = start;
    return values;
  }
  const step = (end - start) / (count - 1);
  for (let index = 0; index < count; index += 1) {
    values[index] = start + step * index;
  }
  values[count - 1] = end;
  return values;
}

export function createGrid(
  dimension: 1 | 2,
  x0: number,
  x1: number,
  nx: number,
  y0 = 0,
  y1 = 0,
  ny = 1,
): Grid {
  if (dimension === 1) {
    return {
      dimension,
      x0,
      x1,
      y0: 0,
      y1: 0,
      nx,
      ny: 1,
      hx: (x1 - x0) / (nx - 1),
      hy: 1,
      x: linspace(x0, x1, nx),
      y: Float64Array.of(0),
    };
  }
  return {
    dimension,
    x0,
    x1,
    y0,
    y1,
    nx,
    ny,
    hx: (x1 - x0) / (nx - 1),
    hy: (y1 - y0) / (ny - 1),
    x: linspace(x0, x1, nx),
    y: linspace(y0, y1, ny),
  };
}

export function idx(i: number, j: number, nx: number): number {
  return j * nx + i;
}

export function assertFinite(label: string, values: ArrayLike<number>): void {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) {
      throw new PdeError(`${label}在网格上出现了非有限值。请检查表达式是否除以零或超出定义域。`);
    }
  }
}

export function sampleFull(grid: Grid, t: number, fn: ScalarField): Float64Array {
  const values = new Float64Array(grid.nx * grid.ny);
  for (let j = 0; j < grid.ny; j += 1) {
    for (let i = 0; i < grid.nx; i += 1) {
      values[idx(i, j, grid.nx)] = fn(grid.x[i], grid.y[j], t);
    }
  }
  assertFinite("场", values);
  return values;
}

export function applyBoundary(field: Float64Array, grid: Grid, t: number, boundary: BoundaryFns): void {
  if (grid.dimension === 1) {
    field[0] = boundary.left(grid.x0, 0, t);
    field[grid.nx - 1] = boundary.right(grid.x1, 0, t);
    assertFinite("边界", field);
    return;
  }
  for (let j = 0; j < grid.ny; j += 1) {
    field[idx(0, j, grid.nx)] = boundary.left(grid.x0, grid.y[j], t);
    field[idx(grid.nx - 1, j, grid.nx)] = boundary.right(grid.x1, grid.y[j], t);
  }
  for (let i = 1; i < grid.nx - 1; i += 1) {
    field[idx(i, 0, grid.nx)] = boundary.bottom(grid.x[i], grid.y0, t);
    field[idx(i, grid.ny - 1, grid.nx)] = boundary.top(grid.x[i], grid.y1, t);
  }
  assertFinite("边界", field);
}

export function sampleInterior(grid: Grid, t: number, fn: ScalarField): Float64Array {
  if (grid.dimension === 1) {
    const values = new Float64Array(grid.nx - 2);
    for (let i = 1; i < grid.nx - 1; i += 1) {
      values[i - 1] = fn(grid.x[i], 0, t);
    }
    assertFinite("源项", values);
    return values;
  }
  const nxi = grid.nx - 2;
  const values = new Float64Array(nxi * (grid.ny - 2));
  for (let j = 1; j < grid.ny - 1; j += 1) {
    for (let i = 1; i < grid.nx - 1; i += 1) {
      values[i - 1 + (j - 1) * nxi] = fn(grid.x[i], grid.y[j], t);
    }
  }
  assertFinite("源项", values);
  return values;
}

export function interiorVector(full: Float64Array, grid: Grid): Float64Array {
  if (grid.dimension === 1) {
    return full.slice(1, grid.nx - 1);
  }
  const nxi = grid.nx - 2;
  const values = new Float64Array(nxi * (grid.ny - 2));
  for (let j = 1; j < grid.ny - 1; j += 1) {
    for (let i = 1; i < grid.nx - 1; i += 1) {
      values[i - 1 + (j - 1) * nxi] = full[idx(i, j, grid.nx)];
    }
  }
  return values;
}

export function writeInterior(full: Float64Array, interior: Float64Array, grid: Grid): void {
  if (grid.dimension === 1) {
    for (let i = 1; i < grid.nx - 1; i += 1) full[i] = interior[i - 1];
    return;
  }
  const nxi = grid.nx - 2;
  for (let j = 1; j < grid.ny - 1; j += 1) {
    for (let i = 1; i < grid.nx - 1; i += 1) {
      full[idx(i, j, grid.nx)] = interior[i - 1 + (j - 1) * nxi];
    }
  }
}

/** Discrete Laplacian at interior nodes of a full grid, including boundary values. */
export function laplacianInterior(full: Float64Array, grid: Grid): Float64Array {
  const invHx2 = 1 / (grid.hx * grid.hx);
  const invHy2 = 1 / (grid.hy * grid.hy);
  const nxi = grid.nx - 2;
  const values = new Float64Array(nxi * (grid.ny - 2));
  for (let j = 1; j < grid.ny - 1; j += 1) {
    for (let i = 1; i < grid.nx - 1; i += 1) {
      const center = full[idx(i, j, grid.nx)];
      const lap =
        (full[idx(i + 1, j, grid.nx)] - 2 * center + full[idx(i - 1, j, grid.nx)]) * invHx2 +
        (full[idx(i, j + 1, grid.nx)] - 2 * center + full[idx(i, j - 1, grid.nx)]) * invHy2;
      values[i - 1 + (j - 1) * nxi] = lap;
    }
  }
  return values;
}

export function toRows(flat: Float64Array, grid: Grid): number[][] {
  const rows: number[][] = [];
  for (let j = 0; j < grid.ny; j += 1) {
    const row = new Array<number>(grid.nx);
    for (let i = 0; i < grid.nx; i += 1) row[i] = flat[idx(i, j, grid.nx)];
    rows.push(row);
  }
  return rows;
}

export function fieldStats(rows: number[][]): { min: number; max: number; mean: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    for (const value of row) {
      if (value < min) min = value;
      if (value > max) max = value;
      sum += value;
      count += 1;
    }
  }
  return { min, max, mean: count === 0 ? 0 : sum / count };
}
