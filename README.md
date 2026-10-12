# PDE Agent

v0.1.0。这是一个 [eve](https://eve.dev) agent，在区间和矩形上求解常系数线性偏微分方程，返回网格上的数值解，并说明用了什么方法。

## 这一版能解什么

| 方程 | 形式 | 区域 | 数值方法 |
| --- | --- | --- | --- |
| Poisson | −Δu = f | 区间或矩形 | 一维：二阶中心差分 + Thomas 算法。二维：五点差分 + 共轭梯度法 |
| 热方程 | u_t = α Δu + f | 区间或矩形 | Crank–Nicolson。一维用 Thomas 算法，二维每个时间步用共轭梯度法 |
| 波动方程 | u_tt = c² Δu + f | 区间或矩形 | 时间和空间上的二阶中心差分。显式格式要求 CFL 数 ≤ 1 |

边界都是 Dirichlet。源项、边界和初值可以是常数，也可以是关于 `x`、`y`、`t` 的表达式。热方程的 α 和波动方程的波速 c 默认是 1。波动方程的初速默认是 0。

如果题目写成 Δu = g，源项要改成 f = −g。

## 环境

需要 Node.js 24。

```bash
nvm use
npm install
```

## 直接求解

不需要模型密钥。JSON 里写方程、区域、边界、初值和离散参数：

```bash
npm run solve -- examples/poisson-2d.json
npm run solve -- examples/heat-1d.json
npm run solve -- examples/wave-1d.json
```

单位正方形上的 Poisson 例子会打印方法和抽样后的解场。中心值应接近 1，对应解析解 sin(πx) sin(πy)。

`examples/` 里还有一维 Poisson、热方程和波动方程。热方程在 t = 0.1 的峰值应接近 exp(−π² × 0.1) ≈ 0.373。波动方程在 t = 1 的解应接近 −sin(πx)。

## 启动 agent

```bash
npm run dev
```

在终端里用自然语言描述方程。agent 会调用工具 `solve_pde`，再根据工具返回的 `explanation` 和最后一帧解场回答。模型走 Vercel AI Gateway，默认是 `openai/gpt-6-luna-fast`。本地第一次运行时按 eve 的提示登录。

开发服务器就绪后，也可以走 HTTP。端口以 `eve dev` 打印的地址为准：

```bash
curl -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"在单位正方形上求解 −Δu = 2π² sin(πx)sin(πy)，边界为 0。"}'
```

接着用返回的 `sessionId` 读取 `GET /eve/v1/session/<sessionId>/stream`。

## 输入

工具和 `npm run solve` 使用同一份结构：

- `equation`：`poisson`、`heat` 或 `wave`
- `domain.x`：`[xmin, xmax]`。二维再给 `domain.y`
- `source`：Poisson 必须提供。热方程和波动方程省略时 f = 0
- `boundary.left` / `right`：一维的两端。二维再给 `bottom` / `top`
- `initial.value`：热方程和波动方程的初值。波动方程可用 `initial.velocity`
- `discretization.nx`：包含边界的节点数，3 到 201。二维再给 `ny`
- `discretization.tEnd` 以及 `dt` 或 `nt`：只用于热方程和波动方程
- `discretization.dtPolicy`：波动方程默认 `stable`，步长超过 CFL 上限时自动缩小。`strict` 会直接报错
- `discretization.snapshots`：保存的时间层数，含起点和终点，最多 21。默认时间问题保存起点和终点

场的写法：

```json
{ "type": "constant", "value": 0 }
{ "type": "expression", "expression": "sin(pi*x)*exp(-t)" }
```

表达式支持 `+ - * / ^`、括号、`sin`、`cos`、`tan`、`exp`、`log`、`ln`、`sqrt`、`abs`、`min`、`max`、`pow`，以及常数 `pi` 和 `e`。

返回的 `frames` 最后一帧是所求解。`values[y 下标][x 下标]`，一维只有一行。Poisson 的时刻是 `null`。

## 测试

```bash
npm test
npm run typecheck
```

测试用已知解析解检查三种方程，并检查空间二阶收敛。包括非齐次边界、源项、非零初速，以及波动方程的 CFL 拒绝和自动缩步。

## 发布

每一版都要发布。步骤：

1. 修改 `package.json` 的 `version`。
2. 在 `CHANGELOG.md` 增加 `## x.y.z — 日期`，写清这一版能解什么、怎么运行。
3. 提交并推送。
4. 在干净的工作区运行 `npm run release`。

`npm run release` 会先跑测试，再创建附注标签 `vX.Y.Z`，推送标签，并用更新日志里的对应段落创建 GitHub Release。标签已存在、工作区不干净，或更新日志缺少该版本时，脚本会停下来。

## 限制

v0.1.0 只解常系数线性方程，区域只支持区间和矩形，边界只支持 Dirichlet。不支持 Neumann、Robin、曲线边界、变系数或非线性方程。每个方向最多 201 个节点，时间步最多 100000 步。二维角点在输出里采用左右边界的值；离散格式不使用角点。初值和边界不一致时，边界值覆盖边界节点。
