import assert from "node:assert/strict";
import { describe, it } from "node:test";
import solvePdeTool from "../agent/tools/solve_pde.ts";

describe("solve_pde tool", () => {
  it("returns the analytical sine field and a method explanation", async () => {
    const returned = await solvePdeTool.execute(
      {
        equation: "poisson",
        domain: { x: [0, 1] },
        source: { type: "expression", expression: "pi^2*sin(pi*x)" },
        boundary: {
          left: { type: "constant", value: 0 },
          right: { type: "constant", value: 0 },
        },
        discretization: { nx: 21 },
      },
      undefined as never,
    );
    assert.ok(returned && typeof returned === "object" && "frames" in returned);
    const result = returned;
    const row = result.frames[0].values[0];
    const mid = row[Math.floor((row.length - 1) / 2)];
    assert.ok(Math.abs(mid - 1) < 5e-3);
    assert.match(result.explanation, /Thomas/);
    assert.match(result.explanation, /Poisson/);

    const projected = await solvePdeTool.toModelOutput?.(result);
    assert.equal(projected?.type, "json");
    if (projected?.type === "json") {
      const value = projected.value as { explanation: string; finalField: number[][] };
      assert.match(value.explanation, /Thomas/);
      assert.equal(value.finalField.length, 1);
      assert.equal(value.finalField[0].length, 21);
    }
  });
});
