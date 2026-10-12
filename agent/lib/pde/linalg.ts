import { PdeError } from "./errors.ts";

/** Solve a[i] u[i-1] + b[i] u[i] + c[i] u[i+1] = d[i]. a[0] and c[n-1] must be 0. */
export function thomas(a: Float64Array, b: Float64Array, c: Float64Array, d: Float64Array): Float64Array {
  const n = b.length;
  const cp = new Float64Array(n);
  const dp = new Float64Array(n);
  if (b[0] === 0) {
    throw new PdeError("三对角方程组的主对角元为零，无法用 Thomas 算法求解。");
  }
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i += 1) {
    const denominator = b[i] - a[i] * cp[i - 1];
    if (denominator === 0) {
      throw new PdeError("三对角方程组出现零主元，无法用 Thomas 算法求解。");
    }
    cp[i] = c[i] / denominator;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / denominator;
  }
  const solution = new Float64Array(n);
  solution[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) {
    solution[i] = dp[i] - cp[i] * solution[i + 1];
  }
  return solution;
}

export function dot(left: Float64Array, right: Float64Array): number {
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) sum += left[index] * right[index];
  return sum;
}

export interface CgResult {
  x: Float64Array;
  iterations: number;
  residual: number;
}

/**
 * Conjugate gradient for a symmetric positive definite operator.
 * `tol` is the relative residual ||Ax-b|| / ||b||.
 */
export function conjugateGradient(
  apply: (x: Float64Array, out: Float64Array) => void,
  b: Float64Array,
  x0: Float64Array,
  tol: number,
  maxIter: number,
): CgResult {
  const n = b.length;
  const x = x0.slice();
  const ax = new Float64Array(n);
  apply(x, ax);
  const residual = new Float64Array(n);
  for (let index = 0; index < n; index += 1) residual[index] = b[index] - ax[index];
  const direction = residual.slice();
  let rho = dot(residual, residual);
  const scale = Math.sqrt(dot(b, b)) || 1;
  let norm = Math.sqrt(rho);
  if (norm / scale <= tol) {
    return { x, iterations: 0, residual: norm };
  }
  for (let iteration = 1; iteration <= maxIter; iteration += 1) {
    apply(direction, ax);
    const curvature = dot(direction, ax);
    if (!(curvature > 0)) {
      throw new PdeError("共轭梯度停止：离散算子不是正定的。");
    }
    const alpha = rho / curvature;
    for (let index = 0; index < n; index += 1) {
      x[index] += alpha * direction[index];
      residual[index] -= alpha * ax[index];
    }
    const nextRho = dot(residual, residual);
    norm = Math.sqrt(nextRho);
    if (norm / scale <= tol) {
      return { x, iterations: iteration, residual: norm };
    }
    const beta = nextRho / rho;
    for (let index = 0; index < n; index += 1) {
      direction[index] = residual[index] + beta * direction[index];
    }
    rho = nextRho;
  }
  throw new PdeError(
    `共轭梯度在 ${maxIter} 步内没有收敛，相对残差为 ${norm / scale}。请加密迭代上限或检查方程。`,
  );
}
