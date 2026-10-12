# 更新日志

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
