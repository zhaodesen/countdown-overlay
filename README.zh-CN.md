# Bang — Countdown Overlay

一个带定时任务、动画主题和离线合成音效的跨平台桌面倒计时 Overlay 应用。

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 项目亮点

- 支持一次性和按周重复的倒计时任务
- 在目标时间前 5 秒显示透明、置顶、鼠标穿透的全屏 Overlay
- 内置 11 款视觉主题，包括赛博朋克、水墨、火焰、冰霜、星空、街机和烟雾
- 使用 GSAP、Canvas 2D 与 WebGL2 流体模拟构建动画和降级链路
- 通过 Web Audio API 生成主题音效，无需捆绑音频文件
- 任务和偏好保存在本地
- 独立显示 UTC+8 时间，不受本机时区影响

## 技术栈

Tauri 2 · Rust · TypeScript · Vite · GSAP · Canvas 2D · WebGL2 · Web Audio

## 快速开始

### 环境要求

- Node.js 与 npm
- Rust stable
- 当前平台对应的 Tauri 系统依赖

### 本地开发

```bash
npm install
npm run tauri dev
```

### 构建

```bash
npm run tauri build
```

## 项目结构

```text
src/shared/    # 任务类型、时间计算、存储和主题元数据
src/settings/  # 调度器与任务管理窗口
src/overlay/   # 倒计时引擎、主题、粒子、背景和音效
src-tauri/     # 原生窗口创建与 Tauri 配置
```

设置窗口轮询即将触发的任务。在目标时间前 5 秒，Rust 会创建覆盖主显示器的无边框透明窗口；Overlay 时间线随后统一编排数字、视觉效果、粒子与音效，并在结束后自动关闭。

## 平台说明

- macOS 12+，支持 Intel 与 Apple Silicon
- Windows 10/11 x64
- 当前不保证多显示器及旧版操作系统体验

## 参与贡献

新增主题应遵循现有主题接口；动画优先使用 transform 与 opacity，避免频繁修改布局属性。
