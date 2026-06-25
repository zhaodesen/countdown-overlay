# 放真实烟雾素材到这里

把你的烟雾视频放到这个文件夹，命名为 `smoke`，扩展名任选其一（按优先级尝试）：

```
public/smoke/smoke.webm     ← 首选（VP9/VP8，体积小、跨平台好）
public/smoke/smoke.mov      ← 备选（H.264/HEVC）
public/smoke/smoke.mp4      ← 备选（H.264）
```

放好后运行 `npm run tauri dev`，选「烟雾」主题预览即可——程序会自动加载它，
**不需要 alpha 通道**：默认按亮度抠像（luma key），所以「白烟 + 纯黑背景」的素材
直接就能用（就是你发的那种）。找不到素材时会自动回退到 GPU 流体模拟。

## 素材建议

- **类型**：白烟、纯黑背景（拍摄或离线渲染都行）。
- **时长**：约 5 秒最佳（和 5→1 倒数同步）；最好是「从上方涌入 → 充满 → 渐散」。
- **分辨率**：1920×1080 或更高；竖屏全屏可用 1080×1920。
- **免费可商用来源**：Pexels、Mixkit、Pixabay 搜 `smoke black background`。

## 调参（如果观感不对）

打开 `src/overlay/video-smoke.ts` 顶部常量：

- `KEY_LOW` / `KEY_HIGH`：抠像阈值。背景没抠干净→调高 `KEY_LOW`；烟太透→调低 `KEY_HIGH`。
- `ALPHA_BOOST`：整体浓度。
- `TINT`：烟的色调（默认冷白）。
- `FADE_OUT_S`：倒数结束时的淡出时长。

## 想用序列帧 PNG（sprite sheet）而不是视频？

可以——把帧图网格（例如 8×8、共 64 帧）发我，并告诉我列数/行数/帧率，
我再加一个 `FlipbookSmoke` 加载器（接口和现在一致）。
