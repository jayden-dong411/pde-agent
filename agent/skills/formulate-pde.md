---
description: 把用户描述的 Poisson、热方程或波动方程整理成 solve_pde 的输入。用户给出方程、区域、边界、初值或网格时使用。
---

# 整理 PDE 输入

先确认方程类型、维数、源项符号、边界、初值和离散参数，再调用 `solve_pde`。

## 符号

- 用户写 −Δu = f、−u'' = f，或 Poisson 方程的源项 f：直接作为 `source`。
- 用户写 Δu = g 或 u'' = g：`source` 用 −g。
- 热方程 u_t = α u_xx 或 u_t = α Δu，没有源项时省略 `source`。
- 波动方程同理。初速没给出时省略 `initial.velocity`，工具按 0 处理。

## 区域和边界

- 一维只给 `domain.x`，边界只给 `left` 和 `right`。
- 二维再给 `domain.y`、`ny`、`bottom` 和 `top`。
- 齐次 Dirichlet 用 `{ "type": "constant", "value": 0 }`。
- 表达式用 `{ "type": "expression", "expression": "sin(pi*x)" }`。变量是 `x`、`y`、`t`。

## 离散

- 节点数包含边界。演示用 21 到 81，需要更准确时再增大，最大 201。
- 热方程和波动方程给 `tEnd`，再给 `dt` 或 `nt`。
- 波动方程默认 `dtPolicy: "stable"`。用户明确要求不要改步长时用 `"strict"`。
- 用户要看演化过程时把 `snapshots` 设为 5 到 9。否则用默认值。

## 例子

单位正方形上 −Δu = 2π² sin(πx)sin(πy)，边界为 0：

```json
{
  "equation": "poisson",
  "domain": { "x": [0, 1], "y": [0, 1] },
  "source": { "type": "expression", "expression": "2*pi^2*sin(pi*x)*sin(pi*y)" },
  "boundary": {
    "left": { "type": "constant", "value": 0 },
    "right": { "type": "constant", "value": 0 },
    "bottom": { "type": "constant", "value": 0 },
    "top": { "type": "constant", "value": 0 }
  },
  "discretization": { "nx": 33, "ny": 33 }
}
```

解析解是 sin(πx)sin(πy)。

区间上 u_t = u_xx，u(x,0) = sin(πx)，两端为 0：

```json
{
  "equation": "heat",
  "domain": { "x": [0, 1] },
  "boundary": {
    "left": { "type": "constant", "value": 0 },
    "right": { "type": "constant", "value": 0 }
  },
  "initial": { "value": { "type": "expression", "expression": "sin(pi*x)" } },
  "discretization": { "nx": 41, "tEnd": 0.1, "dt": 0.001, "dtPolicy": "strict" }
}
```

解析解是 exp(−π² t) sin(πx)。

区间上 u_tt = u_xx，u(x,0) = sin(πx)，u_t(x,0) = 0，两端为 0：

```json
{
  "equation": "wave",
  "domain": { "x": [0, 1] },
  "boundary": {
    "left": { "type": "constant", "value": 0 },
    "right": { "type": "constant", "value": 0 }
  },
  "initial": {
    "value": { "type": "expression", "expression": "sin(pi*x)" },
    "velocity": { "type": "constant", "value": 0 }
  },
  "discretization": { "nx": 81, "tEnd": 1, "dt": 0.01, "dtPolicy": "strict" }
}
```

解析解是 cos(π t) sin(πx)。
