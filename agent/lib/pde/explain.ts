import type { SolveResult } from "./types.ts";

const EQUATION_NAME = {
  poisson: "Poisson 方程",
  heat: "热方程",
  wave: "波动方程",
} as const;

export function explain(result: Omit<SolveResult, "explanation">): string {
  const dimension = result.dimension === 1 ? "一" : "二";
  const parts = [
    `求解的是${dimension}维${EQUATION_NAME[result.equation]}。`,
    formula(result),
    `方法：${result.method.summary}`,
    gridSentence(result),
  ];
  if (result.diagnostics.steps !== null && result.diagnostics.dt !== null) {
    parts.push(
      `时间推进 ${result.diagnostics.steps} 步，实际步长 Δt = ${formatNum(result.diagnostics.dt)}。`,
    );
    if (result.diagnostics.dtAdjusted && result.diagnostics.dtRequested !== null) {
      parts.push(`请求的步长是 ${formatNum(result.diagnostics.dtRequested)}，为了对齐终止时刻或满足稳定性，已改用实际步长。`);
    }
  }
  if (result.diagnostics.cfl !== null) {
    parts.push(`CFL 数是 ${formatNum(result.diagnostics.cfl)}，上限是 ${formatNum(result.diagnostics.cflLimit ?? 1)}。`);
  }
  if (result.diagnostics.iterations !== null) {
    parts.push(`共轭梯度共迭代 ${result.diagnostics.iterations} 步，线性残差 ${formatNum(result.diagnostics.residual ?? 0)}。`);
  } else if (result.diagnostics.residual !== null) {
    parts.push(`离散方程残差的最大值是 ${formatNum(result.diagnostics.residual)}。`);
  }
  const final = result.frames[result.frames.length - 1];
  const when = final?.t === null || final?.t === undefined ? "解场" : `t = ${formatNum(final.t)} 的解场`;
  parts.push(
    `${when}的最小值是 ${formatNum(result.diagnostics.min)}，最大值是 ${formatNum(result.diagnostics.max)}，平均值是 ${formatNum(result.diagnostics.mean)}。`,
  );
  parts.push("网格值按 values[y 下标][x 下标] 排列；一维问题只有一行。最后一帧是所求的解。");
  if (result.ignoredCoefficients.length > 0) {
    parts.push(`已忽略不适用于该方程的系数：${result.ignoredCoefficients.join("、")}。`);
  }
  return parts.join("");
}

function formula(result: Omit<SolveResult, "explanation">): string {
  if (result.equation === "poisson") {
    return result.dimension === 1 ? "方程形式是 −u'' = f。" : "方程形式是 −Δu = f。";
  }
  if (result.equation === "heat") {
    const alpha = result.coefficients.alpha ?? 1;
    const factor = alpha === 1 ? "" : `${formatNum(alpha)} `;
    return result.dimension === 1
      ? `方程形式是 u_t = ${factor}u_xx + f。`
      : `方程形式是 u_t = ${factor}Δu + f。`;
  }
  const speed = result.coefficients.waveSpeed ?? 1;
  const factor = speed === 1 ? "" : `${formatNum(speed)}² `;
  return result.dimension === 1
    ? `方程形式是 u_tt = ${factor}u_xx + f。`
    : `方程形式是 u_tt = ${factor}Δu + f。`;
}

function gridSentence(result: Omit<SolveResult, "explanation">): string {
  const nx = result.grid.x.length;
  const sentence = `x 方向 ${nx} 个节点，Δx = ${formatNum(result.grid.hx)}，区间 [${formatNum(result.domain.x[0])}, ${formatNum(result.domain.x[1])}]。`;
  if (result.dimension === 1 || !result.grid.y || !result.domain.y) return sentence;
  return `${sentence} y 方向 ${result.grid.y.length} 个节点，Δy = ${formatNum(result.grid.hy ?? 0)}，区间 [${formatNum(result.domain.y[0])}, ${formatNum(result.domain.y[1])}]。`;
}

export function formatNum(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e6)) return value.toExponential(4);
  return String(Math.round(value * 1e8) / 1e8);
}
