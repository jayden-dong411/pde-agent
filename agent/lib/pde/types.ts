export type EquationType = "poisson" | "heat" | "wave";
export type DtPolicy = "strict" | "stable";

export type FieldSpec =
  | { type: "constant"; value: number }
  | { type: "expression"; expression: string };

export type BoundarySide =
  | FieldSpec
  | { type: "dirichlet"; value: FieldSpec }
  | { type: "neumann"; value: FieldSpec }
  | { type: "robin"; sigma: number | FieldSpec; value: FieldSpec };

export interface BoundarySpec {
  left: BoundarySide;
  right: BoundarySide;
  bottom?: BoundarySide;
  top?: BoundarySide;
}

/** Removes the additive constant in a pure Neumann Poisson problem. */
export interface Normalization {
  type: "pin";
  value: number;
  x?: number;
  y?: number;
}

export interface SolveInput {
  equation: EquationType;
  domain: {
    x: [number, number];
    y?: [number, number];
  };
  coefficients?: {
    alpha?: number;
    waveSpeed?: number;
  };
  source?: FieldSpec;
  boundary: BoundarySpec;
  initial?: {
    value: FieldSpec;
    velocity?: FieldSpec;
  };
  normalization?: Normalization;
  discretization: {
    nx: number;
    ny?: number;
    tEnd?: number;
    dt?: number;
    nt?: number;
    snapshots?: number;
    dtPolicy?: DtPolicy;
  };
}

export interface SolutionFrame {
  /** Null for the stationary Poisson solution. */
  t: number | null;
  /** values[yIndex][xIndex]. One-dimensional problems have a single row. */
  values: number[][];
}

export interface SolveResult {
  equation: EquationType;
  dimension: 1 | 2;
  method: {
    name: string;
    accuracy: string;
    summary: string;
  };
  domain: {
    x: [number, number];
    y?: [number, number];
  };
  coefficients: {
    alpha: number | null;
    waveSpeed: number | null;
  };
  grid: {
    x: number[];
    y?: number[];
    hx: number;
    hy: number | null;
  };
  /** Last frame is the solution at tEnd. Poisson has one frame with t = null. */
  frames: SolutionFrame[];
  layout: string;
  diagnostics: {
    min: number;
    max: number;
    mean: number;
    steps: number | null;
    dt: number | null;
    dtRequested: number | null;
    dtAdjusted: boolean;
    cfl: number | null;
    cflLimit: number | null;
    iterations: number | null;
    residual: number | null;
  };
  ignoredCoefficients: string[];
  explanation: string;
}
