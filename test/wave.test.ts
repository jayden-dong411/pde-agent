import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdeError } from "../agent/lib/pde/errors.ts";
import { expr, maxAbsError, solve, zero } from "./helpers.ts";

describe("wave", () => {
  it("matches the standing wave with zero initial velocity", () => {
    const exact = (x: number, _y: number, t: number) => Math.cos(Math.PI * t) * Math.sin(Math.PI * x);
    const run = (nx: number, dt: number) =>
      solve({
        equation: "wave",
        domain: { x: [0, 1] },
        coefficients: { waveSpeed: 1 },
        boundary: { left: zero, right: zero },
        initial: { value: expr("sin(pi*x)"), velocity: zero },
        discretization: { nx, tEnd: 1, dt, dtPolicy: "strict", snapshots: 3 },
      });
    const coarse = maxAbsError(run(41, 0.02), exact);
    const fine = maxAbsError(run(81, 0.01), exact);
    const result = run(81, 0.01);
    assert.equal(result.method.name, "explicit-central-difference");
    assert.equal(result.frames.at(-1)?.t, 1);
    assert.ok((result.diagnostics.cfl ?? 2) < 1);
    assert.ok(fine < 2e-3, `fine error ${fine}`);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("matches a wave started from a nonzero initial velocity", () => {
    const exact = (x: number, _y: number, t: number) => Math.sin(Math.PI * x) * Math.sin(Math.PI * t);
    const result = solve({
      equation: "wave",
      domain: { x: [0, 1] },
      boundary: { left: zero, right: zero },
      initial: {
        value: zero,
        velocity: expr("pi*sin(pi*x)"),
      },
      discretization: { nx: 81, tEnd: 0.5, dt: 0.005, dtPolicy: "strict" },
    });
    assert.ok(maxAbsError(result, exact) < 2e-3, `error ${maxAbsError(result, exact)}`);
  });

  it("matches the two-dimensional standing wave", () => {
    const exact = (x: number, y: number, t: number) =>
      Math.cos(Math.PI * Math.SQRT2 * t) * Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    const result = solve({
      equation: "wave",
      domain: { x: [0, 1], y: [0, 1] },
      boundary: { left: zero, right: zero, bottom: zero, top: zero },
      initial: { value: expr("sin(pi*x)*sin(pi*y)"), velocity: zero },
      discretization: { nx: 41, ny: 41, tEnd: 0.25, dt: 0.01, dtPolicy: "strict", snapshots: 2 },
    });
    assert.ok(maxAbsError(result, exact) < 5e-3, `error ${maxAbsError(result, exact)}`);
  });

  it("rejects an unstable explicit step in strict mode and repairs it in stable mode", () => {
    const input = {
      equation: "wave" as const,
      domain: { x: [0, 1] as [number, number] },
      boundary: { left: zero, right: zero },
      initial: { value: expr("sin(pi*x)") },
      discretization: { nx: 21, tEnd: 0.2, dt: 0.2, dtPolicy: "strict" as const },
    };
    assert.throws(() => solve(input), /CFL/);
    const stable = solve({
      ...input,
      discretization: { ...input.discretization, dtPolicy: "stable" },
    });
    assert.equal(stable.diagnostics.dtAdjusted, true);
    assert.ok((stable.diagnostics.cfl ?? 2) <= 1);
    assert.ok(stable.explanation.includes("CFL"));
  });

  it("rejects a missing initial value", () => {
    assert.throws(
      () =>
        solve({
          equation: "wave",
          domain: { x: [0, 1] },
          boundary: { left: zero, right: zero },
          discretization: { nx: 11, tEnd: 0.1, dt: 0.01 },
        }),
      PdeError,
    );
  });
});
