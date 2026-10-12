import { PdeError } from "./errors.ts";

export interface TimePlan {
  dt: number;
  steps: number;
  dtRequested: number;
  adjusted: boolean;
  cfl: number | null;
  cflLimit: number | null;
}

export function planTime(input: {
  tEnd: number;
  dt?: number;
  nt?: number;
  dtMax?: number;
  policy: "strict" | "stable";
}): TimePlan {
  if (input.dt !== undefined && input.nt !== undefined) {
    throw new PdeError("discretization 里请只提供 dt 或 nt 其中一个。");
  }
  if (input.dt === undefined && input.nt === undefined) {
    throw new PdeError("热方程和波动方程需要 discretization.dt 或 discretization.nt。");
  }
  const requested = input.nt !== undefined ? input.tEnd / input.nt : input.dt!;
  if (!(requested > 0) || !Number.isFinite(requested)) {
    throw new PdeError("时间步长必须是正数。");
  }

  let target = requested;
  if (input.dtMax !== undefined && input.policy === "stable") {
    target = Math.min(target, input.dtMax * 0.95);
  }

  let steps = Math.max(1, Math.round(input.tEnd / target));
  let dt = input.tEnd / steps;
  if (dt > target * (1 + 1e-8)) {
    steps = Math.max(1, Math.ceil(input.tEnd / target - 1e-12));
    dt = input.tEnd / steps;
  }

  if (input.dtMax !== undefined && dt > input.dtMax * (1 + 1e-6)) {
    throw new PdeError(
      `时间步长 ${formatStep(dt)} 超过波动方程的 CFL 上限 ${formatStep(input.dtMax)}。请减小 dt，或把 discretization.dtPolicy 设为 "stable"。`,
    );
  }
  if (steps > 100_000) {
    throw new PdeError(`时间步数 ${steps} 超过上限 100000。请增大 dt 或缩短 tEnd。`);
  }

  return {
    dt,
    steps,
    dtRequested: requested,
    adjusted: Math.abs(dt - requested) > 1e-8 * Math.max(1, requested),
    cfl: input.dtMax === undefined ? null : dt / input.dtMax,
    cflLimit: input.dtMax === undefined ? null : 1,
  };
}

function formatStep(value: number): string {
  return value.toExponential(6);
}

export interface CapturedFrame {
  t: number;
  values: Float64Array;
}

/** Advance a uniform time grid and keep solution snapshots, including the endpoints when requested. */
export function captureSnapshots(input: {
  tEnd: number;
  dt: number;
  steps: number;
  count: number;
  initial: Float64Array;
  advance: (field: Float64Array, t: number, dt: number) => Float64Array;
}): CapturedFrame[] {
  const count = Math.max(1, input.count);
  const times = snapshotTimes(input.tEnd, count);
  const frames: CapturedFrame[] = [];
  let next = 0;
  let t = 0;
  let field = input.initial;
  while (next < times.length && times[next] <= 1e-12) {
    frames.push({ t: 0, values: field.slice() });
    next += 1;
  }
  for (let step = 0; step < input.steps; step += 1) {
    const previous = field;
    const t0 = t;
    field = input.advance(field, t, input.dt);
    t += input.dt;
    while (next < times.length && times[next] <= t + 1e-9 * (1 + input.tEnd)) {
      frames.push({
        t: times[next],
        values: lerp(previous, field, t0, t, times[next]),
      });
      next += 1;
    }
  }
  return frames;
}

function snapshotTimes(tEnd: number, count: number): number[] {
  if (count === 1) return [tEnd];
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    times.push((tEnd * index) / (count - 1));
  }
  times[count - 1] = tEnd;
  return times;
}

function lerp(left: Float64Array, right: Float64Array, t0: number, t1: number, t: number): Float64Array {
  const weight = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
  const values = new Float64Array(left.length);
  const stay = 1 - weight;
  for (let index = 0; index < left.length; index += 1) {
    values[index] = stay * left[index] + weight * right[index];
  }
  return values;
}
