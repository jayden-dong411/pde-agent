import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PdeError } from "../agent/lib/pde/errors.ts";
import { expr, maxAbsError, solve, zero } from "./helpers.ts";

describe("poisson", () => {
  it("matches the quadratic solution exactly in one dimension", () => {
    const result = solve({
      equation: "poisson",
      domain: { x: [0, 1] },
      source: expr("-2"),
      boundary: { left: zero, right: expr("1") },
      discretization: { nx: 33 },
    });
    assert.equal(result.method.name, "thomas-second-order");
    assert.ok(maxAbsError(result, (x) => x * x) < 1e-10);
    assert.ok((result.diagnostics.residual ?? 1) < 1e-8);
  });

  it("converges at second order for the sine solution", () => {
    const exact = (x: number) => Math.sin(Math.PI * x);
    const coarse = maxAbsError(
      solve({
        equation: "poisson",
        domain: { x: [0, 1] },
        source: expr("pi^2*sin(pi*x)"),
        boundary: { left: zero, right: zero },
        discretization: { nx: 17 },
      }),
      exact,
    );
    const fine = maxAbsError(
      solve({
        equation: "poisson",
        domain: { x: [0, 1] },
        source: expr("pi^2*sin(pi*x)"),
        boundary: { left: zero, right: zero },
        discretization: { nx: 33 },
      }),
      exact,
    );
    assert.ok(fine < 1e-3);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("matches x^2 + y^2 on the unit square", () => {
    const result = solve({
      equation: "poisson",
      domain: { x: [0, 1], y: [0, 1] },
      source: expr("-4"),
      boundary: {
        left: expr("y^2"),
        right: expr("1 + y^2"),
        bottom: expr("x^2"),
        top: expr("x^2 + 1"),
      },
      discretization: { nx: 25, ny: 25 },
    });
    assert.equal(result.method.name, "five-point-conjugate-gradient");
    assert.equal(result.dimension, 2);
    assert.ok(maxAbsError(result, (x, y) => x * x + y * y) < 1e-8);
    assert.ok((result.diagnostics.iterations ?? 0) > 0);
  });

  it("converges at second order for the two-dimensional sine solution", () => {
    const exact = (x: number, y: number) => Math.sin(Math.PI * x) * Math.sin(Math.PI * y);
    const input = (n: number) =>
      solve({
        equation: "poisson",
        domain: { x: [0, 1], y: [0, 1] },
        source: expr("2*pi^2*sin(pi*x)*sin(pi*y)"),
        boundary: { left: zero, right: zero, bottom: zero, top: zero },
        discretization: { nx: n, ny: n },
      });
    const coarse = maxAbsError(input(17), exact);
    const fine = maxAbsError(input(33), exact);
    assert.ok(fine < 2e-3);
    assert.ok(fine < coarse / 3, `coarse ${coarse}, fine ${fine}`);
  });

  it("requires a source term", () => {
    assert.throws(
      () =>
        solve({
          equation: "poisson",
          domain: { x: [0, 1] },
          boundary: { left: zero, right: zero },
          discretization: { nx: 5 },
        }),
      PdeError,
    );
  });
});
