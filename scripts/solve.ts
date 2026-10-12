import { readFileSync } from "node:fs";
import { solvePde } from "../agent/lib/pde/solve.ts";
import type { SolveInput } from "../agent/lib/pde/types.ts";
import { PdeError } from "../agent/lib/pde/errors.ts";

const file = process.argv[2];
if (!file || file === "--help" || file === "-h") {
  console.log(`用法: npm run solve -- <problem.json>

从 JSON 文件读取方程、区域、边界、初值和离散参数，打印方法和数值解摘要。
示例: npm run solve -- examples/poisson-2d.json`);
  process.exit(file ? 0 : 1);
}

try {
  const problem = JSON.parse(readFileSync(file, "utf8")) as SolveInput;
  const result = solvePde(problem);
  const finalFrame = result.frames[result.frames.length - 1];
  console.log(result.explanation);
  console.log("");
  console.log(
    JSON.stringify(
      {
        method: result.method.name,
        diagnostics: result.diagnostics,
        finalTime: finalFrame.t,
        preview: preview(finalFrame.values),
      },
      null,
      2,
    ),
  );
} catch (error) {
  const message = error instanceof PdeError || error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

function preview(rows: number[][]): number[][] {
  const ny = rows.length;
  const nx = rows[0]?.length ?? 0;
  if (nx <= 17 && ny <= 17) return rows;
  const xIndexes = sample(nx, 9);
  const yIndexes = sample(ny, 9);
  return yIndexes.map((j) => xIndexes.map((i) => round(rows[j][i])));
}

function sample(count: number, maxCount: number): number[] {
  if (count <= maxCount) return Array.from({ length: count }, (_value, index) => index);
  const indexes: number[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    indexes.push(Math.round((index * (count - 1)) / (maxCount - 1)));
  }
  return indexes;
}

function round(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
