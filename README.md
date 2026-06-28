# Countdown Overlay

跨平台桌面**倒计时 Overlay** 应用。控制台管理多个定时任务，到达「目标时间前 5 秒」时弹出全屏、透明、置顶、可鼠标穿透的 Overlay 窗口，中央依次播放 `5 → 4 → 3 → 2 → 1` 的炫酷动画（GSAP 编排 + Canvas 2D 粒子 + 程序化音效），结束后自动关闭。

技术栈：**Tauri 2 + Rust 后端 + TypeScript 前端 + GSAP + Canvas 2D**（动画背景接口稳定，可平滑升级 WebGL / Three.js）。

---

## 支持平台

- **macOS 12+**：Intel 与 Apple Silicon（Universal 安装包）。
- **Windows 10/11**：x64。
- 暂不承诺支持旧版 macOS、Windows 7/8、Windows ARM64 和多显示器。

---

## 功能总览

- **实时北京时间**：顶栏显示「年月日 周几 时分秒」，UTC+8，不受本机时区影响。
- **定时任务（增删改查 + 本地持久化）**：任务含名称、目标时间（年月日时分秒，新建默认「当前 +1 分钟」）、类型（一次性 / 重复-按周一至周日）、动画效果、启用开关。数据存于 `localStorage`，重启保留。
- **11 款动画主题**，风格各异，均可一键「预览」全屏播放：
  1. 赛博朋克（霓虹故障 + 数字雨）2. 科技 HUD（全息环 + 扫描线）3. 武侠（剑气 + 泼墨 + 金书）4. 水墨（宣纸 + 墨点）5. 卡通（弹跳 + 漫画爆点）6. 烈焰（火星 + 爆燃）7. 冰霜（冰晶 + 飘雪）8. 星空（曲速 + 星海）9. 复古街机（CRT + 像素）10. 黄金庆典（金箔 + 烟花）11. **烟雾（写实，GPU 流体模拟）：倒计时出现时一大片烟雾从屏幕顶部喷涌而下，真实翻滚卷曲，随倒数逐渐散去**。
- **音效开关**：每个主题配有契合风格的音效（程序化合成，见下），可全局开/关。

> **关于音效**：采用 **Web Audio 程序化合成**（振荡器 + 噪声 + 包络）而非下载音频文件——完全离线、零体积、无版权顾虑。每个主题在 `themes.ts` 里用极简的 `sound.tone()/noise()/arp()` 描述自己的「滴答声 + 收尾音」。如需换成真实音效文件，把文件放入并在主题里改成 `new Audio(...)` 即可，接口已预留。

## 1. 项目结构

```
countdown-overlay/
├── index.html                 # 控制台（设置）窗口入口
├── overlay.html               # Overlay 窗口入口
├── vite.config.ts             # 多入口 + Tauri dev server (1420)
├── src/
│   ├── shared/
│   │   ├── types.ts           # Task / 设置 / OverlayConfig 类型 + 常量
│   │   ├── time.ts            # 北京时间换算 + 下次触发计算
│   │   ├── storage.ts         # localStorage 读写（两窗口共享）
│   │   └── themes-meta.ts     # 10 主题的轻量元数据（控制台用）
│   ├── settings/
│   │   ├── main.ts            # 时钟 / 任务 CRUD / 主题网格 / 调度器
│   │   └── style.css
│   └── overlay/
│       ├── main.ts            # 读配置、装配引擎、结束关闭
│       ├── engine.ts          # 主题无关的 GSAP 倒计时引擎
│       ├── themes.ts          # 10 个主题定义（视觉 + 粒子 + 音效）
│       ├── backgrounds.ts     # 按主题的 Canvas 背景（雨/星空/火/雪/HUD/纸屑/水墨）
│       ├── fluid.ts           # GPU 流体模拟烟雾（WebGL2 Navier-Stokes，首选）
│       ├── smoke.ts           # Canvas2D 烟雾（精灵叠加，WebGL 不可用时回退）
│       ├── particles.ts       # 可配置粒子爆发系统
│       ├── sound.ts           # Web Audio 程序化音效引擎
│       └── style.css          # 基础样式 + 10 套主题皮肤
└── src-tauri/
    ├── Cargo.toml / build.rs / tauri.conf.json
    ├── capabilities/default.json
    ├── icons/
    └── src/{main.rs, lib.rs}  # show_overlay：创建透明置顶穿透窗口
```

## 2. 关键模块职责

| 模块 | 职责 |
| --- | --- |
| `shared/time.ts` | 北京 wall-clock ↔ epoch 互转；`nextFireEpoch()` 计算一次性/重复任务的下次触发点（目标 − 5s）。 |
| `shared/storage.ts` | 任务、设置、Overlay 配置的 `localStorage` 持久化。两个窗口同源，配置即靠它在窗口间传递。 |
| `settings/main.ts` | 北京时钟；任务列表与编辑弹窗（增删改、启用切换、按周重复）；10 主题网格 + 预览；500ms 轮询调度器。 |
| `src-tauri/src/lib.rs` | `show_overlay` 命令：按主显示器尺寸创建无边框/透明/置顶/隐藏任务栏/鼠标穿透窗口。 |
| `overlay/engine.ts` | 主题无关的 GSAP 主时间轴，驱动 5→1，把「外观」委托给当前主题。 |
| `overlay/themes.ts` | 10 个主题：入场风格、粒子爆发、色相、音效、顶部横幅。 |
| `overlay/backgrounds.ts` | 7 种 Canvas 背景控制器（参数化复用到 10 主题）。 |
| `overlay/particles.ts` | 可配置粒子系统（形状/颜色/重力/拖拽/冲击波）。 |
| `overlay/sound.ts` | Web Audio 合成原语：`tone / noise / chord / arp`。 |

## 3. 实现步骤（已完成）

1. 共享层：北京时间、持久化、类型、主题元数据。
2. 控制台：实时时钟 + 任务 CRUD + 重复调度 + 主题网格 + 音效开关。
3. Overlay：主题无关引擎 + 10 主题 + 7 种背景 + 可配置粒子 + 合成音效。
4. 窗口间配置通过同源 `localStorage` 传递；Rust 端创建透明穿透窗口。
5. 类型检查（`tsc`）与构建（`vite build`）通过。

## 4. Tauri 窗口配置建议

- **主窗口**：固定 460×420、居中。
- **Overlay 窗口**（在 `lib.rs` 编程创建，便于将来「每显示器一个窗口」）：`decorations(false)` 无边框、`transparent(true)` 透明（macOS 需 `macOSPrivateApi` + Cargo `macos-private-api`，已配置）、`always_on_top(true)`、`skip_taskbar(true)`、`focused(false)` 不抢焦点、`set_ignore_cursor_events(true)` 鼠标穿透；尺寸/位置按 `primary_monitor()` 物理尺寸 ÷ 缩放因子计算。不使用原生 `fullscreen` 以避免 macOS 进入独立 Space。

## 5. 前端动画设计方案

- **GSAP Timeline** 串 5 个子时间轴，各约 1.0s；只动 `scale/rotation/opacity/filter/x` + CSS 变量 `--ghost`（残影），避免改 `top/left/width/height`，保 60 FPS。
- 每个数字：主题入场（冲击/故障/弹跳/笔触/曲速/飘移）→ 白色冲击闪光 → 残影 → 中心冲击波环 → 光晕脉冲 → 模糊退出。
- **粒子爆发**：每次数字变化触发 `field.burst()`，形状/颜色/重力按主题不同（火花、星、纸片、花瓣…）。
- **背景**：每主题一个持续运行的 Canvas 背景（数字雨 / 星空曲速 / 升腾火星 / 飘雪 / HUD 环 / 纸屑 / 水墨云）。
- **音效**：每个数字一个滴答音 + 倒数结束一个收尾音，由各主题用合成原语描述。
- 透明背景 + 轻微暗角/光晕；水墨/武侠用半透明宣纸底以衬托墨色数字。

### 烟雾主题：GPU 流体模拟（fluid.ts）

「烟雾」主题用 WebGL2 在 GPU 上实时解算不可压缩 Navier–Stokes（Jos Stam「Stable Fluids」）：

1. 速度场平流（advect）→ 2. 涡量约束（vorticity confinement，制造卷曲细节）→ 3. 散度（divergence）→ 4. Jacobi 迭代解压力（默认 20 次）→ 5. 减去压力梯度得到无散度速度 → 6. 烟雾密度（dye）随速度场平流 → 7. 着色渲染（按密度梯度做廉价自阴影 + 顶部受光，预乘 alpha 输出到透明窗口）。

`erupt()` 在顶部边缘持续注入向下的速度 + 白色烟雾约 1 秒形成喷射；之后不再注入，密度自然耗散，烟雾散去——正好与 5→1 同步。

可调常量都在 `fluid.ts` 顶部：`SIM_RES`（速度场分辨率/性能）、`DYE_RES`（烟雾清晰度）、`PRESSURE_ITERATIONS`、`VELOCITY_DISSIPATION`、`DYE_DISSIPATION`（越大散得越快）、`CURL`（卷曲强度）、`JET_VELOCITY`/`JET_DYE`/`ERUPT_DURATION`（喷射强度与时长）。

**最逼真：真实素材**。把一段烟雾视频放到 `public/smoke/smoke.webm`(或 `.mov`/`.mp4`)即可——`video-smoke.ts` 会用 WebGL 按亮度抠像(luma key)合成,**白烟黑底素材无需 alpha 通道**直接可用。详见 `public/smoke/README.md`。

**优先级(最逼真→最省事)**:真实素材(若 `public/smoke/` 有片) → GPU 流体模拟(WebGL2) → Canvas2D 精灵。后两者在前者不可用时自动回退,效果不中断。

## 6. 验收标准

- [ ] 顶栏实时显示北京时间（年月日 周几 时分秒）。
- [ ] 可新建/编辑/删除任务，启用开关有效，刷新/重启后数据仍在。
- [ ] 任务支持一次性与重复（选周一～周日），重复任务按下次匹配时刻触发。
- [ ] 新建任务默认时间为「当前 +1 分钟」。
- [ ] 点击任一主题「预览」立即全屏播放该主题倒计时。
- [ ] 到达「目标前 5 秒」自动用任务所选主题弹出 Overlay。
- [ ] Overlay：覆盖主屏、无边框、透明、置顶、任务栏无图标、鼠标穿透。
- [ ] 10 款主题视觉/音效风格明显不同；音效可一键开/关。
- [ ] 倒计时结束 Overlay 自动关闭，回到控制台。
- [ ] 动画流畅（目标 60 FPS）。

## 7. 后续增强路线

- **多显示器**：遍历 `available_monitors()`，每屏一个 `overlay-<i>` 窗口（已预留）。
- **系统托盘 + 开机自启**：`tray-icon` feature、`tauri-plugin-autostart`。
- **更强持久化**：迁移到 `tauri-plugin-store`（JSON 落盘）替代 localStorage。
- **WebGL / Three.js 主题**：在 `backgrounds.ts` 同一 `{ destroy() }` 接口下实现 GPU 粒子与辉光后处理。
- **真实音效**：替换合成音为版权友好的音频文件（接口已预留）。
- **任务高级项**：提前量可调、节假日跳过、声音音量、每任务独立音效开关。

---

## 如何运行

> 需本机已装 **Node.js 18+**、**Rust 工具链**（rustup）及对应平台 Tauri 系统依赖（见 https://tauri.app/start/prerequisites/ ）。

```bash
cd countdown-overlay
npm install
npm run tauri dev      # 开发（热重载）
npm run tauri build    # 打包发布
```

首次 `tauri dev` 编译 Rust 依赖较慢属正常。

## 如何验证

1. `npm run tauri dev` 打开控制台，确认顶部北京时间在走。
2. 点任意主题的「预览」——应立即全屏播放该风格的 5→1 动画并发声（音效开时）。把音效开关关掉再预览，应静音。
3. 「新建任务」：名称随意，时间设为「当前 +约 15 秒」，选一种动画，保存。
4. 等待——到「目标前 5 秒」自动弹出对应主题 Overlay；把鼠标移到 Overlay 上点击下方应用，验证**鼠标穿透**；结束后自动回到控制台。
5. 新建一个「重复」任务，勾选今天对应的星期与一个临近时刻，验证按周触发。
6. 关闭并重开应用，确认任务仍在（持久化）。

### 仅验证前端（无需 Rust）

```bash
npm install
npx tsc --noEmit       # 类型检查
npm run build          # 构建两个入口
npm run dev            # 浏览器打开 http://localhost:1420 预览控制台；点预览会新开 overlay 页
```

> 浏览器预览时，Overlay 结束调用的 `window.close()`/Tauri API 不生效（仅动画/音效可见可听），属正常；自动调度与真正的透明穿透窗口需在 `tauri dev` 下体验。音效首次可能需与页面交互一次以满足浏览器自动播放策略（Tauri 桌面端通常无此限制）。
