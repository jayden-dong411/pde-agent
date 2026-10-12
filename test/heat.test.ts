import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expr, maxAbsError, solve, zero } from "./helpers.ts";

describe("heat", () => {
  it("matches the separated sine solution and converges", () => {
    const exact = (x: number, _y: number, t: number) => Math.exp(-(Math.PI ** 2) * t) * Math.sin(Math.PI * x);
    const run = (nx: number, dt: number) =>
      solve({
        equation: "heat",
        domain: { x: [0, 1] },
        coefficients: { alpha: 1 },
        boundary: { left: zero, right: zero },
        initial: { value: expr("sin(pi*x)") },
        discretization: { nx, tEnd: 0.1, dt, dtPolicy: "strict", snapshots: 2 },
      });
    const coarse = maxAbsError(run(21, 0.004), exact);
    const fine = maxAbsError(run(41, 0.001), exact);
    assert.equal(run(41, 0.001).method.name, "crank-nicolson");
    assert.equal(run(41, 0.001).frames.at(-1)?.t, 0.1);
    assert.ok(fine < 5e-4, `fine error ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("accepts a source term and a time-dependent Dirichlet boundary", () => {
    const exact = (x: number, _y: number, t: number) => Math.exp(-t) * (x + 1);
    const result = solve({
      equation: "heat",
      domain: { x: [0, 1] },
      source: expr("-(x + 1)*exp(-t)"),
      boundary: {
        left: expr("exp(-t)"),
        right: expr("2*exp(-t)"),
      },
      initial: { value: expr("x + 1") },
      discretization: { nx: 21, tEnd: 0.2, dt: 0.001, dtPolicy: "strict" },
    });
    assert.ok(maxAbsError(result, exact) < 1e-4);
  });

  it("matches the two-dimensional product solution", () => {
    const exact = (x: number, y: number, t: number) =>
      Math.exp(-2 * Math.PI ** 2 * t) * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    const result = solve({
      equation: "heat",
      domain: { x: [0, 1], y: [0, 1] },
      boundary: { left: zero, right: zero, bottom: zero, top: zero },
      initial: { value: expr("sin(pi*x)*sin(pi*y)") },
      discretization: { nx: 25, ny: 25, tEnd: 0.05, dt: 0.0025, dtPolicy: "strict", snapshots: 2 },
    });
    assert.equal(result.method.name, "crank-nicolson-conjugate-gradient");
    assert.ok(maxAbsError(result, exact) < 2e-3, `error ${maxAbsError(result, exact)}`);
    assert.ok((result.diagnostics.iterations ?? 0) > 0);
  });
});
