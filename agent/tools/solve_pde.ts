import { defineTool } from "eve/tools";
import { z } from "zod";
import { solvePde, type SolveInput, type SolveResult } from "../lib/pde/solve.ts";

const fieldSchema = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("constant"),
      value: z.number(),
    }),
    z.object({
      type: z.literal("expression"),
      expression: z.string().min(1),
    }),
  ])
  .describe("常数，或关于 x、y、t 的表达式。支持 + - * / ^、括号，以及 sin、cos、tan、exp、log、ln、sqrt、abs、min、max、pow 和常数 pi、e。");

const sideSchema = z.union([
  fieldSchema,
  z.object({ type: z.literal("dirichlet"), value: fieldSchema }),
  z.object({ type: z.literal("neumann"), value: fieldSchema }),
  z.object({
    type: z.literal("robin"),
    sigma: z.union([z.number(), fieldSchema]),
    value: fieldSchema,
  }),
]).describe("省略 kind 时视为 Dirichlet。Neumann 与 Robin 使用外法向：∂u/∂n + σ u = g，Neumann 的 σ 为 0。");

const solveInputSchema = z.object({
  equation: z.enum(["poisson", "heat", "wave"]).describe("poisson：−Δu = f；heat：u_t = α Δu + f；wave：u_tt = c² Δu + f。"),
  domain: z.object({
    x: z.tuple([z.number(), z.number()]).describe("[xmin, xmax]"),
    y: z.tuple([z.number(), z.number()]).optional().describe("给出 [ymin, ymax] 时按二维矩形求解；省略时按一维区间求解。"),
  }),
  coefficients: z
    .object({
      alpha: z.number().optional().describe("热方程扩散系数 α，默认 1。"),
      waveSpeed: z.number().optional().describe("波动方程波速 c，默认 1。"),
    })
    .optional(),
  source: fieldSchema.optional().describe("右端项 f。Poisson 方程必须提供。热方程和波动方程省略时视为 0。"),
  boundary: z.object({
    left: sideSchema.describe("x = xmin。外法向是 −∂/∂x。"),
    right: sideSchema.describe("x = xmax。外法向是 ∂/∂x。"),
    bottom: sideSchema.optional().describe("二维问题 y = ymin。外法向是 −∂/∂y。"),
    top: sideSchema.optional().describe("二维问题 y = ymax。外法向是 ∂/∂y。"),
  }),
  normalization: z
    .object({
      type: z.literal("pin"),
      value: z.number(),
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .optional()
    .describe("仅纯 Neumann 的 Poisson：把解平移到指定节点的值。省略时把节点平均值平移到 0。"),
  initial: z
    .object({
      value: fieldSchema.describe("u 在 t = 0 的值。"),
      velocity: fieldSchema.optional().describe("仅波动方程：u_t 在 t = 0 的值，默认 0。"),
    })
    .optional(),
  discretization: z.object({
    nx: z.number().int().min(3).max(201).describe("包含边界在内的 x 方向节点数。"),
    ny: z.number().int().min(3).max(201).optional().describe("二维问题包含边界在内的 y 方向节点数。"),
    tEnd: z.number().optional().describe("热方程和波动方程的终止时刻。"),
    dt: z.number().optional().describe("请求的时间步长。与 nt 二选一。"),
    nt: z.number().int().positive().max(100_000).optional().describe("时间步数。与 dt 二选一。"),
    snapshots: z.number().int().min(1).max(21).optional().describe("保存的时间层数，含起点和终点。默认时间问题为 2，Poisson 为 1。"),
    dtPolicy: z
      .enum(["strict", "stable"])
      .optional()
      .describe('波动方程默认 stable：步长超过 CFL 上限时自动缩小。strict：超过上限就报错。'),
  }),
});

export default defineTool({
  description:
    "在区间或矩形上求解线性 Poisson、热方程或波动方程，返回网格解、使用的数值方法和简短说明。定常问题用 poisson（−Δu = f）；演化问题用 heat（u_t = α Δu + f）或 wave（u_tt = c² Δu + f）。边界可以是 Dirichlet、外法向 Neumann，或 Robin 条件 ∂u/∂n + σ u = g。不要自行编造网格值，数值结果以这个工具返回的 frames 最后一帧为准。",
  inputSchema: solveInputSchema,
  execute(input): SolveResult {
    return solvePde(input as SolveInput);
  },
  label: {
    start: ({ equation }) => `求解 ${equation} 方程`,
    complete: (_input, output) => `已用 ${output.method.name} 得到数值解`,
  },
  toModelOutput(output) {
    const finalFrame = output.frames[output.frames.length - 1];
    const projected = projectField(finalFrame?.values ?? []);
    return {
      type: "json",
      value: {
        equation: output.equation,
        dimension: output.dimension,
        method: output.method,
        explanation: output.explanation,
        diagnostics: output.diagnostics,
        layout: output.layout,
        domain: output.domain,
        grid: {
          x: projectAxis(output.grid.x, projected.xIndexes),
          y: output.grid.y ? projectAxis(output.grid.y, projected.yIndexes) : undefined,
          hx: output.grid.hx,
          hy: output.grid.hy,
        },
        finalTime: finalFrame?.t ?? null,
        finalField: projected.values,
        finalFieldDownsampled: projected.downsampled,
        frameTimes: output.frames.map((frame) => frame.t),
        note: projected.downsampled
          ? "finalField 是完结解的抽样。完整网格在工具结果的 frames 最后一帧，按 values[y 下标][x 下标] 排列。"
          : "finalField 是完结解的完整网格，按 values[y 下标][x 下标] 排列。",
      },
    };
  },
});

function projectField(rows: number[][]): {
  values: number[][];
  downsampled: boolean;
  xIndexes: number[];
  yIndexes: number[];
} {
  const ny = rows.length;
  const nx = rows[0]?.length ?? 0;
  if (nx * ny <= 2500) {
    return {
      values: rows,
      downsampled: false,
      xIndexes: indexRange(nx),
      yIndexes: indexRange(ny),
    };
  }
  const xIndexes = sampleIndexes(nx, 17);
  const yIndexes = sampleIndexes(ny, 17);
  return {
    values: yIndexes.map((j) => xIndexes.map((i) => rows[j][i])),
    downsampled: true,
    xIndexes,
    yIndexes,
  };
}

function projectAxis(values: number[], indexes: number[]): number[] {
  return indexes.map((index) => values[index]);
}

function indexRange(count: number): number[] {
  return Array.from({ length: count }, (_value, index) => index);
}

function sampleIndexes(count: number, maxCount: number): number[] {
  if (count <= maxCount) return indexRange(count);
  const indexes: number[] = [];
  for (let index = 0; index < maxCount; index += 1) {
    indexes.push(Math.round((index * (count - 1)) / (maxCount - 1)));
  }
  return indexes;
}

export type { SolveResult };
