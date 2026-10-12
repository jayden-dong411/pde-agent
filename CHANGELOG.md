# 更新日志

## 0.2.0 — 2026-10-12

在 v0.1.0 的 Dirichlet 求解器上增加 Neumann 和 Robin 边界。三种方程、一维和二维都可以混用这些边界。

- Neumann 给出外法向导数 ∂u/∂n。左端是 −∂u/∂x，右端是 ∂u/∂x，下边是 −∂u/∂y，上边是 ∂u/∂y。
- Robin 是 ∂u/∂n + σ u = g。σ 可以是常数或表达式。
- 边界用二阶虚点消去，离散方程按有限体积权重缩放。一维用 Thomas 算法，二维用共轭梯度；热方程仍是 Crank–Nicolson，波动方程仍是显式中心差分。
- 纯 Neumann 的 Poisson 方程差一个常数。默认把节点平均值平移到 0，也可以用 `normalization: { "type": "pin", "value": ... }` 固定一个节点。不相容的源项和通量会报错。

运行新例子：

```bash
nvm use
npm install
npm test
npm run solve -- examples/poisson-1d-neumann.json
npm run solve -- examples/heat-1d-neumann.json
npm run solve -- examples/poisson-2d-robin.json
npm run dev
```

`poisson-1d-neumann.json` 的解析解是 cos(πx/2)。`heat-1d-neumann.json` 是两端无通量的冷却余弦。`poisson-2d-robin.json` 的精确解是 x² + y²。

## 0.1.0 — 2026-10-12

第一个可用版本。PDE Agent 在区间和矩形上求解常系数线性方程，并给出网格解和数值方法说明。

这一版能解：

- Poisson 方程 −Δu = f，一维用二阶中心差分和 Thomas 算法，二维用五点差分和共轭梯度法。
- 热方程 u_t = α Δu + f，使用 Crank–Nicolson 格式。二维每个时间步用共轭梯度法。
- 波动方程 u_tt = c² Δu + f，使用二阶中心差分。显式格式会检查 CFL 条件，`dtPolicy: "stable"` 会自动把步长降到稳定范围内。

边界是 Dirichlet。源项、边界和初值可以是常数，也可以是关于 x、y、t 的表达式。

运行：

```bash
nvm use
npm install
npm test
npm run solve -- examples/poisson-2d.json
npm run dev
```

`npm run solve` 直接运行数值求解器，不需要模型密钥。`npm run dev` 启动 eve agent，用自然语言描述方程后，agent 会调用 `solve_pde`。

发布下一版时，更新 `package.json` 的 `version` 和本文件对应的 `## x.y.z` 段落，提交后在干净的工作区运行 `npm run release`。脚本会跑测试、打附注标签 `vX.Y.Z`、推送标签，并用这一节作为 GitHub Release 的说明。
