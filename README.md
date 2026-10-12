# PDE Agent

v0.2.0。这是一个 [eve](https://eve.dev) agent，在区间和矩形上求解常系数线性偏微分方程。它返回网格上的数值解，并说明用了什么方法。

每版改了什么写在仓库里的 [版本改进.md](版本改进.md)。发布条目在 [CHANGELOG.md](CHANGELOG.md)。这两个文件都在 git 提交里，不只写在 GitHub Release 页面上。

## 先跑通

需要 Node.js 24。

```bash
nvm use
npm install
npm test
npm run solve -- examples/poisson-1d-neumann.json
```

最后一条命令不需要模型密钥。它求解

−u'' = (π/2)² cos(πx/2)，x ∈ [0, 1]，

左端外法向导数为 0，右端 u(1) = 0。解析解是 cos(πx/2)。程序会打印方法和抽样后的解。左端应接近 1，右端是 0。例如 33 个节点时，解的最大值约为 1.0002，离散残差约为 10⁻¹³。

其余可直接运行的例子：

| 文件 | 方程 | 边界 | 用来核对的解 |
| --- | --- | --- | --- |
| `examples/poisson-1d.json` | 一维 Poisson | 两端 Dirichlet 0 | sin(πx) |
| `examples/poisson-2d.json` | 二维 Poisson | 四边 Dirichlet 0 | sin(πx) sin(πy)，中心约 1 |
| `examples/poisson-1d-neumann.json` | 一维 Poisson | 左 Neumann 0，右 Dirichlet 0 | cos(πx/2) |
| `examples/poisson-2d-robin.json` | 二维 Poisson | 左、下 Dirichlet，右 Neumann，上 Robin | x² + y² |
| `examples/heat-1d.json` | 一维热方程 | 两端 Dirichlet 0 | exp(−π² t) sin(πx)，t = 0.1 时峰值约 0.373 |
| `examples/heat-1d-neumann.json` | 一维热方程 | 两端 Neumann 0 | exp(−π² t) cos(πx) |
| `examples/wave-1d.json` | 一维波动方程 | 两端 Dirichlet 0 | cos(πt) sin(πx)，t = 1 时约为 −sin(πx) |

## 这一版能解什么

| 方程 | 形式 | 区域 | 数值方法 |
| --- | --- | --- | --- |
| Poisson | −Δu = f | 区间或矩形 | 全 Dirichlet 时：一维 Thomas，二维五点差分 + 共轭梯度。有 Neumann 或 Robin 时：二阶虚点，一维仍用 Thomas，二维用共轭梯度 |
| 热方程 | u_t = α Δu + f | 区间或矩形 | Crank–Nicolson。一维用 Thomas，二维每个时间步用共轭梯度。α 默认 1 |
| 波动方程 | u_tt = c² Δu + f | 区间或矩形 | 时间、空间二阶中心差分。CFL 数必须 ≤ 1。波速 c 默认 1，初速默认 0 |

如果题目写成 Δu = g，源项要改成 f = −g。

## 边界条件

外法向 n 指向区域外面：

- 左端 ∂u/∂n = −∂u/∂x，右端 ∂u/∂n = ∂u/∂x
- 下边 ∂u/∂n = −∂u/∂y，上边 ∂u/∂n = ∂u/∂y

三种写法：

```json
{ "type": "constant", "value": 0 }
{ "type": "neumann", "value": { "type": "constant", "value": 0 } }
{ "type": "robin", "sigma": 2, "value": { "type": "expression", "expression": "2*x^2 + 4" } }
```

直接写常数或表达式时，按 Dirichlet 处理。`type: "dirichlet"` 也是 Dirichlet。Neumann 的 `value` 是外法向导数。Robin 表示 ∂u/∂n + σ u = g，σ 可以是数字或表达式。

纯 Neumann 的 Poisson 方程差一个常数。不给 `normalization` 时，节点平均值被平移到 0。要固定某个点：

```json
"normalization": { "type": "pin", "value": 1, "x": 0, "y": 0 }
```

源项和边界通量必须满足 ∫f dV + ∫ ∂u/∂n dS = 0，否则求解会报不相容。热方程和波动方程的纯 Neumann 问题不需要这个平移。

波动方程默认 `dtPolicy: "stable"`：步长超过 CFL 上限时自动缩小。设成 `"strict"` 时，超限直接报错，并给出允许的最大步长。

## 输入

`npm run solve` 和 agent 工具 `solve_pde` 用同一份 JSON。

- `equation`：`poisson`、`heat` 或 `wave`
- `domain.x`：`[xmin, xmax]`。二维再给 `domain.y`
- `source`：Poisson 必须提供。热方程和波动方程省略时 f = 0
- `boundary.left` / `right`：一维的两端。二维再给 `bottom` / `top`
- `normalization`：只用于纯 Neumann 的 Poisson
- `initial.value`：热方程和波动方程的初值。波动方程可用 `initial.velocity`
- `discretization.nx`：包含边界的节点数，3 到 201。二维再给 `ny`
- `discretization.tEnd` 以及 `dt` 或 `nt`：只用于热方程和波动方程，二者只给一个
- `discretization.dtPolicy`：`stable` 或 `strict`
- `discretization.snapshots`：保存的时间层数，含起点和终点，1 到 21。时间问题默认 2，Poisson 默认 1

场可以写成：

```json
{ "type": "constant", "value": 0 }
{ "type": "expression", "expression": "sin(pi*x)*exp(-t)" }
```

表达式支持 `+ - * / ^`、括号、`sin`、`cos`、`tan`、`exp`、`log`、`ln`、`sqrt`、`abs`、`min`、`max`、`pow`，以及常数 `pi` 和 `e`。变量只有 `x`、`y`、`t`。

返回值里，`frames` 的最后一帧是所求解。`values[y 下标][x 下标]`，一维只有一行。Poisson 的时刻 `t` 是 `null`。`explanation` 是一段中文，说明方程、方法、网格和最小、最大、平均值。`diagnostics` 里还有时间步、CFL、迭代次数和残差。

## 启动 agent

```bash
npm run dev
```

在终端里用自然语言描述方程。agent 会调用 `solve_pde`，再根据工具返回的 `explanation` 和最后一帧解场回答。模型走 Vercel AI Gateway，默认是 `openai/gpt-6-luna-fast`。本地第一次运行时按 eve 的提示登录。

开发服务器就绪后，也可以走 HTTP。端口以 `eve dev` 打印的地址为准：

```bash
curl -X POST http://127.0.0.1:2000/eve/v1/session \
  -H 'content-type: application/json' \
  -d '{"message":"在单位区间上求解 Poisson 方程，源项 (pi/2)^2*cos(pi*x/2)，左端 Neumann 为 0，右端 Dirichlet 为 0。"}'
```

接着用返回的 `sessionId` 读取 `GET /eve/v1/session/<sessionId>/stream`。

## 仓库里有什么

| 路径 | 作用 |
| --- | --- |
| `README.md` | 本说明。用法、例子和限制都在这份提交里的文件中 |
| `版本改进.md` | 每一版相对上一版的改进，以及对应例子 |
| `CHANGELOG.md` | 发布说明。`npm run release` 用其中的版本段落作为 Release 正文 |
| `agent/instructions.md` | agent 的固定说明 |
| `agent/skills/formulate-pde.md` | 把题目整理成工具输入的步骤 |
| `agent/tools/solve_pde.ts` | 供 agent 调用的求解工具 |
| `agent/lib/pde/` | 有限差分求解器 |
| `examples/` | 上面表格里的方程 |
| `test/` | 对照解析解的测试，含二阶收敛 |
| `scripts/solve.ts` | 命令行求解 |
| `scripts/release.ts` | 打标签、推送，并把已提交的说明文件附到 Release |

## 测试

```bash
npm test
npm run typecheck
```

测试用已知解析解检查三种方程，并检查空间二阶收敛。覆盖 Dirichlet、Neumann、Robin、纯 Neumann 的常数平移、非齐次边界、源项、非零初速，以及波动方程的 CFL 拒绝和自动缩步。

## 发布

每一版都要发布。说明文件必须先进入 git 提交，不要只写在 GitHub Release 页面上。

1. 修改 `package.json` 的 `version`。
2. 在 `版本改进.md` 和 `CHANGELOG.md` 都增加 `## x.y.z — 日期`。写清相对上一版的改进，以及怎么运行。需要改用法时，同时改这份 `README.md`。
3. 把这些文件和代码一起提交并推送。
4. 在干净的工作区运行 `npm run release`。

`npm run release` 会先跑测试，再创建附注标签 `vX.Y.Z`，推送标签，用 `CHANGELOG.md` 里的对应段落作为 Release 正文，并把已提交的 `版本改进.md`、`CHANGELOG.md` 和 `README.md` 作为附件上传。GitHub 附件里的版本说明文件名是 `version-notes.md`，内容就是仓库里的 `版本改进.md`。标签已存在、工作区不干净，或这两个说明文件缺少该版本时，脚本会停下来。

## 限制

v0.2.0 只解常系数线性方程，区域只支持区间和矩形。不支持曲线边界、变系数或非线性方程。每个方向最多 201 个节点，时间步最多 100000 步。两条 Dirichlet 边交汇时，角点采用左右边界的值。Neumann 或 Robin 边上的角点是未知量。初值和 Dirichlet 边界不一致时，边界值覆盖那些边界节点。
