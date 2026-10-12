import type { SideCondition, SideSet } from "./boundary.ts";
import { compileExpression, type ScalarField } from "./expression.ts";
import { PdeError } from "./errors.ts";
import type { BoundaryFns } from "./grid.ts";
import type { BoundarySide, DtPolicy, EquationType, FieldSpec, SolveInput } from "./types.ts";

const MAX_NODES = 201;
const ZERO: ScalarField = () => 0;

export interface Problem {
  equation: EquationType;
  dimension: 1 | 2;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  nx: number;
  ny: number;
  alpha: number;
  waveSpeed: number;
  source: ScalarField;
  boundary: BoundaryFns;
  sides: SideSet;
  /** Pure Neumann Poisson pin. Null means the nodal mean is set to zero when needed. */
  normalization: { value: number; x: number | null; y: number | null } | null;
  initial: ScalarField | null;
  velocity: ScalarField;
  tEnd: number | null;
  dt?: number;
  nt?: number;
  snapshots: number;
  dtPolicy: DtPolicy;
  ignoredCoefficients: string[];
}

export function normalizeProblem(input: SolveInput): Problem {
  const equation = input?.equation;
  if (equation !== "poisson" && equation !== "heat" && equation !== "wave") {
    throw new PdeError("equation 必须是 poisson、heat 或 wave。");
  }
  const domainX = input.domain?.x;
  if (!Array.isArray(domainX) || domainX.length !== 2) {
    throw new PdeError("domain.x 必须是 [xmin, xmax]。");
  }
  const x0 = finiteNumber(domainX[0], "domain.x[0]");
  const x1 = finiteNumber(domainX[1], "domain.x[1]");
  if (!(x1 > x0)) {
    throw new PdeError("domain.x 需要 xmax > xmin。");
  }

  const hasY = input.domain.y !== undefined;
  let y0 = 0;
  let y1 = 0;
  if (hasY) {
    const domainY = input.domain.y;
    if (!Array.isArray(domainY) || domainY.length !== 2) {
      throw new PdeError("domain.y 必须是 [ymin, ymax]。");
    }
    y0 = finiteNumber(domainY[0], "domain.y[0]");
    y1 = finiteNumber(domainY[1], "domain.y[1]");
    if (!(y1 > y0)) {
      throw new PdeError("domain.y 需要 ymax > ymin。");
    }
  }
  const dimension: 1 | 2 = hasY ? 2 : 1;

  const nx = integerIn(input.discretization?.nx, 3, MAX_NODES, "discretization.nx");
  let ny = 1;
  if (dimension === 2) {
    if (input.discretization.ny === undefined) {
      throw new PdeError("二维问题需要 discretization.ny。");
    }
    ny = integerIn(input.discretization.ny, 3, MAX_NODES, "discretization.ny");
  } else if (input.discretization?.ny !== undefined) {
    throw new PdeError("一维问题不要设置 discretization.ny；二维问题才需要 domain.y。");
  }

  if (!input.boundary?.left || !input.boundary?.right) {
    throw new PdeError("boundary.left 和 boundary.right 都是必需的。");
  }
  if (dimension === 2 && (!input.boundary.bottom || !input.boundary.top)) {
    throw new PdeError("二维问题需要 boundary.bottom 和 boundary.top。");
  }
  if (dimension === 1 && (input.boundary.bottom || input.boundary.top)) {
    throw new PdeError("一维问题不要设置 boundary.bottom 或 boundary.top。");
  }

  const sides: SideSet = {
    left: normalizeSide(input.boundary.left, "boundary.left"),
    right: normalizeSide(input.boundary.right, "boundary.right"),
    bottom: input.boundary.bottom
      ? normalizeSide(input.boundary.bottom, "boundary.bottom")
      : { kind: "dirichlet", value: ZERO, sigma: ZERO },
    top: input.boundary.top
      ? normalizeSide(input.boundary.top, "boundary.top")
      : { kind: "dirichlet", value: ZERO, sigma: ZERO },
  };
  const boundary: BoundaryFns = {
    left: sides.left.value,
    right: sides.right.value,
    bottom: sides.bottom.value,
    top: sides.top.value,
  };
  const normalization = normalizePin(input.normalization);

  const ignoredCoefficients: string[] = [];
  const coefficients = input.coefficients ?? {};
  let alpha = 1;
  let waveSpeed = 1;
  if (equation === "heat") {
    if (coefficients.alpha !== undefined) alpha = positiveNumber(coefficients.alpha, "coefficients.alpha");
    if (coefficients.waveSpeed !== undefined) ignoredCoefficients.push("waveSpeed");
  } else if (equation === "wave") {
    if (coefficients.waveSpeed !== undefined) {
      waveSpeed = positiveNumber(coefficients.waveSpeed, "coefficients.waveSpeed");
    }
    if (coefficients.alpha !== undefined) ignoredCoefficients.push("alpha");
  } else {
    if (coefficients.alpha !== undefined) ignoredCoefficients.push("alpha");
    if (coefficients.waveSpeed !== undefined) ignoredCoefficients.push("waveSpeed");
  }

  let source = ZERO;
  if (equation === "poisson") {
    if (!input.source) {
      throw new PdeError("Poisson 方程需要 source，对应 −Δu = f 中的 f。");
    }
    source = compileField(input.source, "source");
    if (input.initial) {
      throw new PdeError("Poisson 方程是定常问题，不要提供 initial。");
    }
    if (
      input.discretization.tEnd !== undefined ||
      input.discretization.dt !== undefined ||
      input.discretization.nt !== undefined
    ) {
      throw new PdeError("Poisson 方程是定常问题，不要提供 tEnd、dt 或 nt。");
    }
  } else if (input.source) {
    source = compileField(input.source, "source");
  }

  let initial: ScalarField | null = null;
  let velocity = ZERO;
  let tEnd: number | null = null;
  if (equation === "heat" || equation === "wave") {
    if (!input.initial?.value) {
      throw new PdeError(`${equation === "heat" ? "热方程" : "波动方程"}需要 initial.value。`);
    }
    initial = compileField(input.initial.value, "initial.value");
    if (equation === "wave" && input.initial.velocity) {
      velocity = compileField(input.initial.velocity, "initial.velocity");
    }
    if (equation === "heat" && input.initial.velocity) {
      throw new PdeError("热方程没有初速，不要提供 initial.velocity。");
    }
    if (input.discretization.tEnd === undefined) {
      throw new PdeError("热方程和波动方程需要 discretization.tEnd。");
    }
    tEnd = positiveNumber(input.discretization.tEnd, "discretization.tEnd");
  }

  const snapshots = input.discretization.snapshots ?? (equation === "poisson" ? 1 : 2);
  if (!Number.isInteger(snapshots) || snapshots < 1 || snapshots > 21) {
    throw new PdeError("discretization.snapshots 必须是 1 到 21 的整数。");
  }

  const dtPolicy = input.discretization.dtPolicy ?? "stable";
  if (dtPolicy !== "strict" && dtPolicy !== "stable") {
    throw new PdeError('discretization.dtPolicy 必须是 "strict" 或 "stable"。');
  }

  return {
    equation,
    dimension,
    x0,
    x1,
    y0,
    y1,
    nx,
    ny,
    alpha,
    waveSpeed,
    source,
    boundary,
    sides,
    normalization,
    initial,
    velocity,
    tEnd,
    dt: input.discretization.dt,
    nt: input.discretization.nt,
    snapshots,
    dtPolicy,
    ignoredCoefficients,
  };
}

function normalizeSide(raw: BoundarySide, label: string): SideCondition {
  if (!raw || typeof raw !== "object" || typeof raw.type !== "string") {
    throw new PdeError(`${label} 必须给出边界条件。`);
  }
  if (raw.type === "constant" || raw.type === "expression") {
    return { kind: "dirichlet", value: compileField(raw, label), sigma: ZERO };
  }
  if (raw.type === "dirichlet" || raw.type === "neumann" || raw.type === "robin") {
    const value = compileField(raw.value, `${label}.value`);
    const sigma = raw.type === "robin" ? compileSigma(raw.sigma, `${label}.sigma`) : ZERO;
    return { kind: raw.type, value, sigma };
  }
  throw new PdeError(`${label} 的 type 必须是 constant、expression、dirichlet、neumann 或 robin。`);
}

function compileSigma(raw: number | FieldSpec | undefined, label: string): ScalarField {
  if (typeof raw === "number") {
    const sigma = finiteNumber(raw, label);
    return () => sigma;
  }
  return compileField(raw as FieldSpec, label);
}

function normalizePin(raw: SolveInput["normalization"]): Problem["normalization"] {
  if (raw === undefined) return null;
  if (!raw || raw.type !== "pin") {
    throw new PdeError('normalization 目前只支持 { type: "pin", value }。');
  }
  const value = finiteNumber(raw.value, "normalization.value");
  const x = raw.x === undefined ? null : finiteNumber(raw.x, "normalization.x");
  const y = raw.y === undefined ? null : finiteNumber(raw.y, "normalization.y");
  return { value, x, y };
}

export function compileField(spec: FieldSpec, label: string): ScalarField {
  if (!spec || (spec.type !== "constant" && spec.type !== "expression")) {
    throw new PdeError(`${label} 必须是 { type: "constant", value } 或 { type: "expression", expression }。`);
  }
  if (spec.type === "constant") {
    const value = finiteNumber(spec.value, label);
    return () => value;
  }
  if (typeof spec.expression !== "string" || spec.expression.trim() === "") {
    throw new PdeError(`${label}.expression 必须是非空字符串。`);
  }
  try {
    return compileExpression(spec.expression);
  } catch (error) {
    if (error instanceof PdeError) {
      throw new PdeError(`${label} 的表达式无法解析：${error.message}`);
    }
    throw error;
  }
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PdeError(`${label} 必须是有限数值。`);
  }
  return value;
}

function positiveNumber(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!(number > 0)) {
    throw new PdeError(`${label} 必须是正数。`);
  }
  return number;
}

function integerIn(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new PdeError(`${label} 必须是 ${min} 到 ${max} 的整数。`);
  }
  return value;
}
