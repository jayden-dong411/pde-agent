export type EquationType = "poisson" | "heat" | "wave";
export type DtPolicy = "strict" | "stable";

export type FieldSpec =
  | { type: "constant"; value: number }
  | { type: "expression"; expression: string };

export interface BoundarySpec {
  left: FieldSpec;
  right: FieldSpec;
  bottom?: FieldSpec;
  top?: FieldSpec;
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
