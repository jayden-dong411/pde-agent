import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdeError } from "../agent/lib/pde/errors.ts";
import { expr, maxAbsError, solve, zero } from "./helpers.ts";

const neumann = (expression: string) => ({ type: "neumann" as const, value: expr(expression) });
const robin = (sigma: number, expression: string) => ({
  type: "robin" as const,
  sigma,
  value: expr(expression),
});
const flux0 = { type: "neumann" as const, value: zero };

describe("neumann and robin boundaries", () => {
  it("is exact for a quadratic with a Neumann end", () => {
    const result = solve({
      equation: "poisson",
      domain: { x: [0, 1] },
      source: expr("-2"),
      boundary: { left: zero, right: neumann("2") },
      discretization: { nx: 21 },
    });
    assert.equal(result.method.name, "finite-volume-mixed-boundary");
    assert.match(result.explanation, /Neumann/);
    assert.ok(maxAbsError(result, (x) => x * x) < 1e-8);
  });

  it("is exact for a quadratic Robin condition", () => {
    const result = solve({
      equation: "poisson",
      domain: { x: [0, 1] },
      source: expr("-2"),
      boundary: { left: robin(1, "1"), right: robin(1, "4") },
      discretization: { nx: 25 },
    });
    assert.ok(maxAbsError(result, (x) => x * x + 1) < 1e-8);
  });

  it("converges for a mixed Neumann-Dirichlet sine", () => {
    const exact = (x: number) => Math.cos((Math.PI * x) / 2);
    const run = (nx: number) =>
      solve({
        equation: "poisson",
        domain: { x: [0, 1] },
        source: expr("(pi/2)^2*cos(pi*x/2)"),
        boundary: { left: flux0, right: zero },
        discretization: { nx },
      });
    const coarse = maxAbsError(run(17), exact);
    const fine = maxAbsError(run(33), exact);
    assert.ok(fine < 1e-3, `fine ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("is exact for a rectangular quadratic with Neumann and Robin sides", () => {
    const result = solve({
      equation: "poisson",
      domain: { x: [0, 1], y: [0, 1] },
      source: expr("-4"),
      boundary: {
        left: expr("y^2"),
        right: neumann("2"),
        bottom: expr("x^2"),
        top: robin(2, "2*x^2 + 4"),
      },
      discretization: { nx: 21, ny: 21 },
    });
    assert.ok(maxAbsError(result, (x, y) => x * x + y * y) < 1e-8);
  });

  it("matches a pure Neumann cosine up to the chosen constant", () => {
    const exact = (x: number) => Math.cos(Math.PI * x);
    const meanZero = solve({
      equation: "poisson",
      domain: { x: [0, 1] },
      source: expr("pi^2*cos(pi*x)"),
      boundary: { left: flux0, right: flux0 },
      discretization: { nx: 33 },
    });
    assert.equal(meanZero.method.name, "finite-volume-pure-neumann");
    assert.ok(maxAbsError(meanZero, exact) < 1e-3);

    const pinned = solve({
      equation: "poisson",
      domain: { x: [0, 1] },
      source: expr("pi^2*cos(pi*x)"),
      boundary: { left: flux0, right: flux0 },
      normalization: { type: "pin", value: 2, x: 0 },
      discretization: { nx: 33 },
    });
    assert.ok(Math.abs(pinned.frames[0].values[0][0] - 2) < 1e-8);
    assert.ok(maxAbsError(pinned, (x) => exact(x) + 1) < 5e-3);
  });

  it("converges for the two-dimensional pure Neumann eigenfunction", () => {
    const exact = (x: number, y: number) => Math.cos(Math.PI * x) * Math.cos(Math.PI * y);
    const run = (n: number) =>
      solve({
        equation: "poisson",
        domain: { x: [0, 1], y: [0, 1] },
        source: expr("2*pi^2*cos(pi*x)*cos(pi*y)"),
        boundary: { left: flux0, right: flux0, bottom: flux0, top: flux0 },
        normalization: { type: "pin", value: 1, x: 0, y: 0 },
        discretization: { nx: n, ny: n },
      });
    const coarse = maxAbsError(run(17), exact);
    const fine = maxAbsError(run(33), exact);
    assert.ok(fine < 2e-3, `fine ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("rejects an incompatible pure Neumann source", () => {
    assert.throws(
      () =>
        solve({
          equation: "poisson",
          domain: { x: [0, 1] },
          source: expr("1"),
          boundary: { left: flux0, right: flux0 },
          discretization: { nx: 11 },
        }),
      /不相容/,
    );
  });

  it("rejects a pin on a Dirichlet problem", () => {
    assert.throws(
      () =>
        solve({
          equation: "poisson",
          domain: { x: [0, 1] },
          source: expr("pi^2*sin(pi*x)"),
          boundary: { left: zero, right: zero },
          normalization: { type: "pin", value: 0 },
          discretization: { nx: 9 },
        }),
      PdeError,
    );
  });

  it("matches homogeneous Neumann heat and converges", () => {
    const exact = (x: number, _y: number, t: number) => Math.exp(-(Math.PI ** 2) * t) * Math.cos(Math.PI * x);
    const run = (nx: number, dt: number) =>
      solve({
        equation: "heat",
        domain: { x: [0, 1] },
        boundary: { left: flux0, right: flux0 },
        initial: { value: expr("cos(pi*x)") },
        discretization: { nx, tEnd: 0.1, dt, dtPolicy: "strict", snapshots: 2 },
      });
    const coarse = maxAbsError(run(21, 0.004), exact);
    const fine = maxAbsError(run(41, 0.001), exact);
    assert.ok(fine < 5e-4, `fine ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("accepts a time-dependent Neumann flux and a Robin end", () => {
    const exact = (x: number, _y: number, t: number) => Math.exp(-t) * (1 + x);
    const result = solve({
      equation: "heat",
      domain: { x: [0, 1] },
      source: expr("-(1+x)*exp(-t)"),
      boundary: { left: neumann("-exp(-t)"), right: robin(1, "3*exp(-t)") },
      initial: { value: expr("1+x") },
      discretization: { nx: 21, tEnd: 0.2, dt: 0.001, dtPolicy: "strict" },
    });
    assert.ok(maxAbsError(result, exact) < 1e-4, `error ${maxAbsError(result, exact)}`);
  });

  it("matches a Neumann standing wave", () => {
    const exact = (x: number, _y: number, t: number) => Math.cos(Math.PI * t) * Math.cos(Math.PI * x);
    const run = (nx: number, dt: number) =>
      solve({
        equation: "wave",
        domain: { x: [0, 1] },
        boundary: { left: flux0, right: flux0 },
        initial: { value: expr("cos(pi*x)"), velocity: zero },
        discretization: { nx, tEnd: 1, dt, dtPolicy: "strict", snapshots: 2 },
      });
    const coarse = maxAbsError(run(41, 0.02), exact);
    const fine = maxAbsError(run(81, 0.01), exact);
    assert.ok(fine < 2e-3, `fine ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("matches two-dimensional Neumann heat and wave solutions", () => {
    const heat = solve({
      equation: "heat",
      domain: { x: [0, 1], y: [0, 1] },
      boundary: { left: flux0, right: flux0, bottom: flux0, top: flux0 },
      initial: { value: expr("cos(pi*x)*cos(pi*y)") },
      discretization: { nx: 21, ny: 21, tEnd: 0.05, dt: 0.005, dtPolicy: "strict", snapshots: 2 },
    });
    const heatExact = (x: number, y: number, t: number) =>
      Math.exp(-2 * Math.PI ** 2 * t) * Math.cos(Math.PI * x) * Math.cos(Math.PI * y);
    assert.ok(maxAbsError(heat, heatExact) < 5e-3, `heat ${maxAbsError(heat, heatExact)}`);

    const wave = solve({
      equation: "wave",
      domain: { x: [0, 1], y: [0, 1] },
      boundary: { left: flux0, right: flux0, bottom: flux0, top: flux0 },
      initial: { value: expr("cos(pi*x)*cos(pi*y)"), velocity: zero },
      discretization: { nx: 21, ny: 21, tEnd: 0.25, dt: 0.01, dtPolicy: "strict", snapshots: 2 },
    });
    const waveExact = (x: number, y: number, t: number) =>
      Math.cos(Math.PI * Math.SQRT2 * t) * Math.cos(Math.PI * x) * Math.cos(Math.PI * y);
    assert.ok(maxAbsError(wave, waveExact) < 5e-3, `wave ${maxAbsError(wave, waveExact)}`);
  });
});
