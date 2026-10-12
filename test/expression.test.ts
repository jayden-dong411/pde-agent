import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileExpression } from "../agent/lib/pde/expression.ts";
import { PdeError } from "../agent/lib/pde/errors.ts";

describe("expression", () => {
  it("evaluates arithmetic, powers, and functions", () => {
    const value = compileExpression("-2^2 + 2^3^2 + sin(pi/2) + sqrt(4) + max(1, 3)");
    assert.equal(value(0, 0, 0), -4 + 512 + 1 + 2 + 3);
  });

  it("reads x, y, and t", () => {
    const value = compileExpression("x + 2*y + 3*t");
    assert.equal(value(1, 2, 3), 14);
  });

  it("rejects unknown names", () => {
    assert.throws(() => compileExpression("foo(x)"), PdeError);
  });
});
