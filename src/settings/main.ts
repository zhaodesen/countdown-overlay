import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { THEME_META, themeName, type ThemeMeta } from "../shared/themes-meta";
import {
  loadSettings,
  loadTasks,
  saveSettings,
  saveTasks,
  uid,
  writeOverlayConfig,
} from "../shared/storage";
import {
  AppSettings,
  EVENT_FINISHED,
  EVENT_SCHEDULE_FIRED,
  EVENT_SCHEDULE_PAUSE,
  SchedulerFiredPayload,
  IntervalUnit,
  Task,
  TaskType,
  TimeMode,
  clampCountdownSeconds,
  MAX_COUNTDOWN_SECONDS,
  MIN_COUNTDOWN_SECONDS,
} from "../shared/types";
import {
  beijingNow,
  beijingWallToEpoch,
  crossedEpoch,
  defaultTaskTime,
  formatTaskTime,
  nextFireEpoch,
  nextOccurrence,
  parseDatetimeLocal,
  toDatetimeLocal,
} from "../shared/time";

const isTauri = "__TAURI_INTERNALS__" in window;
const pad = (n: number) => String(n).padStart(2, "0");

if (isTauri && document.documentElement.classList.contains("os-win")) {
  const appWindow = getCurrentWindow();
  document.getElementById("titlebarMinimize")?.addEventListener("click", () => void appWindow.minimize());
  document.getElementById("titlebarMaximize")?.addEventListener("click", () => void appWindow.toggleMaximize());
  document.getElementById("titlebarClose")?.addEventListener("click", () => void appWindow.close());
  document.querySelector<HTMLElement>(".titlebar-left")?.addEventListener("dblclick", (event) => {
    if (!(event.target as HTMLElement).closest("button")) void appWindow.toggleMaximize();
  });
}

let tasks: Task[] = loadTasks();
let settings: AppSettings = loadSettings();
settings.countdownSeconds = clampCountdownSeconds(settings.countdownSeconds);

type ViewName = "home" | "themes" | "settings";

/* ---------------- DOM refs ---------------- */
const clockTimeEl = document.getElementById("clockTime") as HTMLElement;
const themeToggle = document.getElementById("themeToggle") as HTMLButtonElement;
const soundToggle = document.getElementById("soundToggle") as HTMLButtonElement;
const settingsDigitsToggle = document.getElementById("settingsDigitsToggle") as HTMLInputElement;
const settingsDurationInput = document.getElementById("settingsDurationInput") as HTMLInputElement;
const taskListEl = document.getElementById("taskList") as HTMLElement | null;
const taskCountEl = document.getElementById("taskCount") as HTMLElement | null;
const tasksHeadEl = document.getElementById("tasksHead") as HTMLElement | null;
const taskScrollEl = document.getElementById("taskScroll") as HTMLElement | null;
const homeEmptyEl = document.getElementById("homeEmpty") as HTMLElement | null;
const themeViewportEl = document.getElementById("themeViewport") as HTMLElement;
const themeCanvasEl = document.getElementById("themeVirtualCanvas") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement | null;

const modal = document.getElementById("taskModal") as HTMLElement;
const form = document.getElementById("taskForm") as HTMLFormElement;
const dialogTitle = document.getElementById("dialogTitle") as HTMLElement;
const fName = document.getElementById("f_name") as HTMLInputElement;
const fTime = document.getElementById("f_time") as HTMLInputElement;
const fDateTime = document.getElementById("f_datetime") as HTMLInputElement;
const themePickerEl = document.getElementById("themePicker") as HTMLElement;
const fIntervalValue = document.getElementById("f_intervalValue") as HTMLInputElement;
const fIntervalUnit = document.getElementById("f_intervalUnit") as HTMLSelectElement;
const typeSegEl = document.getElementById("typeSeg") as HTMLElement;
const targetRow = document.getElementById("targetRow") as HTMLElement;
const targetModeSegEl = document.getElementById("targetModeSeg") as HTMLElement;
const timeHintEl = document.getElementById("timeHint") as HTMLElement;
const weekdayRow = document.getElementById("weekdayRow") as HTMLElement;
const weekdaysEl = document.getElementById("weekdays") as HTMLElement;
const intervalRow = document.getElementById("intervalRow") as HTMLElement;
const dialogErrorEl = document.getElementById("dialogError") as HTMLElement;
const wizardTrackEl = document.getElementById("wizardTrack") as HTMLElement;
const wizardStepsEl = document.getElementById("wizardSteps") as HTMLElement;
const wizardSubEl = document.getElementById("wizardSub") as HTMLElement;
const wizardSummaryEl = document.getElementById("wizardSummary") as HTMLElement;
const wizardBackBtn = document.getElementById("wizardBack") as HTMLButtonElement;
const wizardNextBtn = document.getElementById("wizardNext") as HTMLButtonElement;
const saveTaskBtn = document.getElementById("saveTask") as HTMLButtonElement;

/* ---------------- Status toast ---------------- */
let statusTimer = 0;
function toast(message: string) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.add("show");
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => statusEl.classList.remove("show"), 3000);
}

/* ---------------- Navigation ---------------- */
function viewFromHash(): ViewName {
  const value = location.hash.replace("#", "");
  return value === "themes" || value === "settings" ? value : "home";
}

function showView(view: ViewName, updateHash = true) {
  document.querySelectorAll<HTMLElement>("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  if (view === "themes") requestAnimationFrame(renderVirtualThemes);
}

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view as ViewName));
});
window.addEventListener("hashchange", () => showView(viewFromHash(), false));

/* ---------------- Collapsible sidebar ---------------- */
const navToggle = document.getElementById("navToggle");
function setNavCollapsed(collapsed: boolean) {
  document.documentElement.classList.toggle("nav-collapsed", collapsed);
  navToggle?.setAttribute("aria-pressed", String(collapsed));
  navToggle?.setAttribute("title", collapsed ? "展开菜单" : "折叠菜单");
  try {
    localStorage.setItem("co.navCollapsed", collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
}
navToggle?.addEventListener("click", () => {
  setNavCollapsed(!document.documentElement.classList.contains("nav-collapsed"));
});
// Reflect the pre-paint state (applied by the inline head script) on the button.
setNavCollapsed(document.documentElement.classList.contains("nav-collapsed"));

/* ---------------- Beijing clock (racing lap-timer reels) ---------------- */
interface Reel {
  strip: HTMLElement;
  value: number;
}
let reels: Reel[] = [];

function setStripPos(strip: HTMLElement, pos: number, animate: boolean) {
  strip.style.transition = animate
    ? "transform 360ms cubic-bezier(0.2, 0.85, 0.25, 1)"
    : "none";
  strip.style.transform = `translateY(${-pos}em)`;
}

function setDigit(reel: Reel, digit: number) {
  if (digit === reel.value) return;
  if (digit >= reel.value) {
    setStripPos(reel.strip, digit, true); // roll forward
  } else {
    // forward-wrap through the trailing "0" cell (index 10) then snap back
    setStripPos(reel.strip, 10, true);
    const onEnd = () => {
      reel.strip.removeEventListener("transitionend", onEnd);
      setStripPos(reel.strip, digit, false);
    };
    reel.strip.addEventListener("transitionend", onEnd);
  }
  reel.value = digit;
}

function buildClock(template: string) {
  clockTimeEl.replaceChildren();
  reels = [];
  for (const ch of template) {
    if (ch === ":") {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = ":";
      clockTimeEl.appendChild(sep);
      continue;
    }
    const reel = document.createElement("span");
    reel.className = "reel";
    const strip = document.createElement("span");
    strip.className = "reel-strip";
    for (let n = 0; n <= 10; n++) {
      const cell = document.createElement("span");
      cell.className = "reel-cell";
      cell.textContent = String(n % 10);
      strip.appendChild(cell);
    }
    reel.appendChild(strip);
    clockTimeEl.appendChild(reel);
    reels.push({ strip, value: 0 });
  }
}

function tickClock() {
  const now = beijingNow();
  const digits = `${pad(now.hour)}${pad(now.minute)}${pad(now.second)}`;
  if (reels.length !== digits.length) buildClock("00:00:00");
  for (let i = 0; i < digits.length; i++) setDigit(reels[i], +digits[i]);
}
setInterval(tickClock, 1000);
tickClock();

/* ---------------- Appearance and sound ---------------- */
function renderAppearance() {
  document.documentElement.dataset.theme = settings.colorMode;
  const themeAction = settings.colorMode === "dark" ? "切换为浅色主题" : "切换为深色主题";
  themeToggle.dataset.mode = settings.colorMode;
  themeToggle.setAttribute("aria-label", themeAction);
  themeToggle.title = themeAction;
}

function syncNativeTheme(mode: AppSettings["colorMode"] = settings.colorMode) {
  if (!isTauri) return;
  void getCurrentWindow().setTheme(mode).catch((error) => {
    console.warn("Unable to sync native window theme:", error);
  });
}

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

function setColorMode(mode: AppSettings["colorMode"]) {
  if (settings.colorMode === mode) return;

  const applyMode = () => {
    settings.colorMode = mode;
    saveSettings(settings);
    renderAppearance();
    syncNativeTheme(mode);
  };
  const transitionDocument = document as ThemeTransitionDocument;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (transitionDocument.startViewTransition && !reduceMotion) {
    transitionDocument.startViewTransition(applyMode);
  } else {
    applyMode();
  }
  toast(mode === "dark" ? "已切换为深色主题" : "已切换为浅色主题");
}

themeToggle.addEventListener("click", () => setColorMode(settings.colorMode === "dark" ? "light" : "dark"));

function renderSound() {
  const soundAction = settings.soundOn ? "关闭音效" : "开启音效";
  soundToggle.dataset.enabled = String(settings.soundOn);
  soundToggle.setAttribute("aria-pressed", String(settings.soundOn));
  soundToggle.setAttribute("aria-label", soundAction);
  soundToggle.title = soundAction;
}

function setSound(enabled: boolean) {
  settings.soundOn = enabled;
  saveSettings(settings);
  renderSound();
  syncNativeSettings();
}

soundToggle.addEventListener("click", () => setSound(!settings.soundOn));

function renderDigits() {
  settingsDigitsToggle.checked = settings.showDigits;
}

function setShowDigits(enabled: boolean) {
  settings.showDigits = enabled;
  saveSettings(settings);
  renderDigits();
  syncNativeSettings();
  toast(enabled ? "倒计时将显示数字" : "倒计时将隐藏数字");
}

settingsDigitsToggle.addEventListener("change", () => setShowDigits(settingsDigitsToggle.checked));

function renderDuration() {
  settingsDurationInput.value = String(settings.countdownSeconds);
}

function setDuration(value: unknown) {
  const seconds = clampCountdownSeconds(value);
  const changed = seconds !== settings.countdownSeconds;
  settings.countdownSeconds = seconds;
  saveSettings(settings);
  renderDuration();
  if (changed) {
    syncNativeSettings();
    toast(`动画时长已设为 ${seconds} 秒`);
  }
}

settingsDurationInput.min = String(MIN_COUNTDOWN_SECONDS);
settingsDurationInput.max = String(MAX_COUNTDOWN_SECONDS);
settingsDurationInput.addEventListener("change", () => setDuration(settingsDurationInput.value));

renderAppearance();
syncNativeTheme();
renderSound();
renderDigits();
renderDuration();

/* ---------------- Update check (GitHub Releases) ---------------- */
const UPDATE_REPO = "zhaodesen/countdown-overlay";

const appVersionEl = document.getElementById("appVersion");
const updateStatusEl = document.getElementById("updateStatus");
const checkUpdateBtn = document.getElementById("checkUpdate") as HTMLButtonElement | null;

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  html_url: string;
  assets: GithubAsset[];
}

let appVersion = "0.0.0";
let pendingUpdate: { version: string; url: string } | null = null;

void getVersion()
  .then((version) => {
    appVersion = version;
    if (appVersionEl) appVersionEl.textContent = `v${version}`;
  })
  .catch(() => {
    if (appVersionEl) appVersionEl.textContent = "开发版";
  });

function setUpdateStatus(text: string) {
  if (updateStatusEl) updateStatusEl.textContent = text;
}

function parseVersion(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => parseInt(part, 10) || 0);
}

function isNewerVersion(remote: string, local: string): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Pick the installer asset matching the current platform (mac → .dmg, windows → .msi/.exe). */
function platformAsset(assets: GithubAsset[]): GithubAsset | null {
  const isMac = document.documentElement.classList.contains("os-mac");
  const suffixes = isMac ? [".dmg"] : [".msi", "-setup.exe", ".exe"];
  for (const suffix of suffixes) {
    const hit = assets.find((asset) => asset.name.toLowerCase().endsWith(suffix));
    if (hit) return hit;
  }
  return null;
}

function openExternal(url: string) {
  if (isTauri) {
    void invoke("open_external", { url }).catch((error) => {
      toast(`无法打开浏览器：${String(error)}`);
    });
  } else {
    window.open(url, "_blank", "noopener");
  }
}

async function checkForUpdates() {
  if (!checkUpdateBtn) return;
  // A found update turns the button into a download shortcut.
  if (pendingUpdate) {
    openExternal(pendingUpdate.url);
    return;
  }
  checkUpdateBtn.disabled = true;
  setUpdateStatus("正在检查…");
  try {
    const response = await fetch(
      `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } }
    );
    if (response.status === 404) {
      setUpdateStatus("暂无发布版本");
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = (await response.json()) as GithubRelease;
    if (!isNewerVersion(release.tag_name, appVersion)) {
      setUpdateStatus(`已是最新版本（${release.tag_name}）`);
      toast("当前已是最新版本");
      return;
    }
    const asset = platformAsset(release.assets);
    pendingUpdate = {
      version: release.tag_name,
      url: asset?.browser_download_url ?? release.html_url,
    };
    checkUpdateBtn.textContent = `下载 ${release.tag_name}`;
    setUpdateStatus(`发现新版本 ${release.tag_name}`);
    toast(`发现新版本 ${release.tag_name}，点击按钮下载`);
  } catch (error) {
    setUpdateStatus("检查失败，请稍后重试");
    toast(`检查更新失败：${String(error)}`);
  } finally {
    checkUpdateBtn.disabled = false;
  }
}

checkUpdateBtn?.addEventListener("click", () => void checkForUpdates());

/* ---------------- Preview ball mode ----------------
   While a preview plays, the main window shrinks to a 50x50 "ball" showing
   just the logo; when the overlay finishes it slowly grows back. */
const BALL_SIZE = 50;
// Must match the main window's minWidth/minHeight in tauri.conf.json.
const WINDOW_MIN_W = 760;
const WINDOW_MIN_H = 560;

interface WinRect {
  w: number;
  h: number;
  x: number;
  y: number;
}

let ballRestoreRect: WinRect | null = null;
let ballBusy = false;
let ballSafetyTimer = 0;

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

async function currentWindowRect(): Promise<WinRect> {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const size = (await win.innerSize()).toLogical(scale);
  const pos = (await win.outerPosition()).toLogical(scale);
  return { w: size.width, h: size.height, x: pos.x, y: pos.y };
}

function animateWindowRect(from: WinRect, to: WinRect, duration: number): Promise<void> {
  const win = getCurrentWindow();
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      void win.setSize(
        new LogicalSize(
          Math.round(from.w + (to.w - from.w) * e),
          Math.round(from.h + (to.h - from.h) * e)
        )
      );
      void win.setPosition(
        new LogicalPosition(
          Math.round(from.x + (to.x - from.x) * e),
          Math.round(from.y + (to.y - from.y) * e)
        )
      );
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

async function shrinkToBall(): Promise<void> {
  if (!isTauri || ballRestoreRect || ballBusy) return;
  ballBusy = true;
  try {
    const win = getCurrentWindow();
    const rect = await currentWindowRect();
    ballRestoreRect = rect;
    document.documentElement.classList.add("ball-mode");
    await win.setMinSize(new LogicalSize(BALL_SIZE, BALL_SIZE));
    await win.setResizable(false);
    await animateWindowRect(
      rect,
      {
        w: BALL_SIZE,
        h: BALL_SIZE,
        x: Math.round(rect.x + (rect.w - BALL_SIZE) / 2),
        y: Math.round(rect.y + (rect.h - BALL_SIZE) / 2),
      },
      280
    );
  } catch (error) {
    console.warn("Unable to shrink window to ball:", error);
  } finally {
    ballBusy = false;
  }
  // Safety net: restore even if the overlay never reports back.
  clearTimeout(ballSafetyTimer);
  ballSafetyTimer = window.setTimeout(
    () => void restoreFromBall(),
    (settings.countdownSeconds + 12) * 1000
  );
}

async function restoreFromBall(): Promise<void> {
  if (!isTauri || !ballRestoreRect || ballBusy) return;
  ballBusy = true;
  clearTimeout(ballSafetyTimer);
  const target = ballRestoreRect;
  ballRestoreRect = null;
  try {
    const win = getCurrentWindow();
    const from = await currentWindowRect(); // the ball may have been dragged
    await animateWindowRect(from, target, 600); // 慢慢复原
    await win.setResizable(true);
    await win.setMinSize(new LogicalSize(WINDOW_MIN_W, WINDOW_MIN_H));
    document.documentElement.classList.remove("ball-mode");
  } catch (error) {
    console.warn("Unable to restore window from ball:", error);
    document.documentElement.classList.remove("ball-mode");
  } finally {
    ballBusy = false;
  }
}

/* ---------------- Open overlay (preview / real) ---------------- */
async function openOverlay(themeId: string, preview: boolean) {
  writeOverlayConfig({
    themeId,
    soundOn: settings.soundOn,
    preview,
    showDigits: settings.showDigits,
    countdownSeconds: settings.countdownSeconds,
  });
  if (!isTauri) {
    window.open("/overlay.html", "_blank", "noopener");
    return;
  }
  if (preview) void shrinkToBall();
  try {
    await invoke("show_overlay", {
      themeId,
      soundOn: settings.soundOn,
      preview,
      showDigits: settings.showDigits,
      countdownSecs: settings.countdownSeconds,
    });
  } catch (error) {
    toast(`无法打开 Overlay：${String(error)}`);
    void restoreFromBall();
  }
}

/* ---------------- Virtual animation library ---------------- */
const VIRTUAL_GAP = 16;
const VIRTUAL_ROW_HEIGHT = 306;
let virtualFrame = 0;
let virtualSignature = "";
const virtualCards = new Map<string, HTMLElement>();

function virtualColumnCount(width: number): number {
  if (width >= 1120) return 3;
  if (width >= 720) return 2;
  return 1;
}

function positionCard(card: HTMLElement, width: number, left: number, top: number): void {
  card.style.width = `${width}px`;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

function themeCard(theme: ThemeMeta, width: number, left: number, top: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "theme-card";
  card.dataset.themeId = theme.id;
  positionCard(card, width, left, top);
  card.innerHTML = `
    <div class="theme-media">
      <img src="${theme.preview}" alt="${theme.name}倒计时动画预览" loading="lazy" decoding="async" />
    </div>
    <div class="theme-body">
      <div>
        <span class="theme-name">${theme.name}</span>
        <span class="theme-cat">${theme.category}</span>
      </div>
      <div class="theme-blurb">${theme.blurb}</div>
      <button class="btn small" type="button" data-preview="${theme.id}">预览</button>
    </div>`;
  const image = card.querySelector("img") as HTMLImageElement;
  const reveal = () => image.classList.add("loaded");
  image.addEventListener("load", reveal, { once: true });
  if (image.complete) reveal();
  return card;
}

function renderVirtualThemes() {
  const width = themeViewportEl.clientWidth - 8;
  const height = themeViewportEl.clientHeight;
  if (width <= 0 || height <= 0) return;

  const columns = virtualColumnCount(width);
  const cardWidth = (width - VIRTUAL_GAP * (columns - 1)) / columns;
  const totalRows = Math.ceil(THEME_META.length / columns);
  const totalHeight = Math.max(0, totalRows * VIRTUAL_ROW_HEIGHT - VIRTUAL_GAP);
  const startRow = Math.max(0, Math.floor(themeViewportEl.scrollTop / VIRTUAL_ROW_HEIGHT) - 1);
  const endRow = Math.min(
    totalRows,
    Math.ceil((themeViewportEl.scrollTop + height) / VIRTUAL_ROW_HEIGHT) + 1
  );
  const signature = `${Math.round(width)}:${columns}:${startRow}:${endRow}`;

  themeCanvasEl.style.height = `${totalHeight}px`;
  if (signature === virtualSignature) return;
  virtualSignature = signature;

  // Reconcile: reuse existing card nodes (keyed by theme id) instead of
  // recreating them. Rebuilding every frame re-instantiates each <img>, which
  // resets its fade-in and makes the list/images flicker while scrolling.
  const needed = new Set<string>();
  const lastIndex = Math.min(THEME_META.length, endRow * columns);
  for (let index = startRow * columns; index < lastIndex; index++) {
    const theme = THEME_META[index];
    const row = Math.floor(index / columns);
    const column = index % columns;
    const left = column * (cardWidth + VIRTUAL_GAP);
    const top = row * VIRTUAL_ROW_HEIGHT;
    needed.add(theme.id);

    const existing = virtualCards.get(theme.id);
    if (existing) {
      positionCard(existing, cardWidth, left, top);
    } else {
      const card = themeCard(theme, cardWidth, left, top);
      virtualCards.set(theme.id, card);
      themeCanvasEl.appendChild(card);
    }
  }

  for (const [id, card] of virtualCards) {
    if (!needed.has(id)) {
      card.remove();
      virtualCards.delete(id);
    }
  }
}

function scheduleVirtualRender() {
  cancelAnimationFrame(virtualFrame);
  virtualFrame = requestAnimationFrame(renderVirtualThemes);
}

themeViewportEl.addEventListener("scroll", scheduleVirtualRender, { passive: true });
new ResizeObserver(() => {
  virtualSignature = "";
  scheduleVirtualRender();
}).observe(themeViewportEl);

themeCanvasEl.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-preview]");
  if (!button) return;
  const themeId = button.dataset.preview as string;
  void openOverlay(themeId, true);
  toast(`预览：${themeName(themeId)}`);
});

/* ---------------- Animation-effect grid picker (dialog step 2) ---------------- */
let selectedThemeId = THEME_META[0].id;

function buildThemePicker() {
  themePickerEl.replaceChildren();
  for (const theme of THEME_META) {
    const card = document.createElement("div");
    card.className = "pick-card";
    card.dataset.themeId = theme.id;
    card.setAttribute("role", "radio");
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="pick-media">
        <img src="${theme.preview}" alt="${theme.name}预览" loading="lazy" decoding="async" />
        <span class="pick-check" aria-hidden="true">✓</span>
        <button type="button" class="pick-preview" data-preview="${theme.id}">预览</button>
      </div>
      <div class="pick-body">
        <div class="pick-name">${theme.name}</div>
        <div class="pick-cat">${theme.category}</div>
      </div>`;
    const image = card.querySelector("img") as HTMLImageElement;
    const reveal = () => image.classList.add("loaded");
    image.addEventListener("load", reveal, { once: true });
    if (image.complete) reveal();
    themePickerEl.appendChild(card);
  }
}

function syncThemePicker() {
  themePickerEl.querySelectorAll<HTMLElement>(".pick-card").forEach((card) => {
    card.setAttribute("aria-checked", String(card.dataset.themeId === selectedThemeId));
  });
}

function selectTheme(id: string) {
  selectedThemeId = id;
  syncThemePicker();
}

themePickerEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const preview = target.closest<HTMLButtonElement>("[data-preview]");
  if (preview) {
    event.stopPropagation();
    const id = preview.dataset.preview as string;
    void openOverlay(id, true);
    toast(`预览：${themeName(id)}`);
    return;
  }
  const card = target.closest<HTMLElement>(".pick-card");
  if (card?.dataset.themeId) selectTheme(card.dataset.themeId);
});

themePickerEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = (event.target as HTMLElement).closest<HTMLElement>(".pick-card");
  if (card?.dataset.themeId) {
    event.preventDefault();
    selectTheme(card.dataset.themeId);
  }
});

/* ---------------- Task list ---------------- */
const WD_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const UNIT_LABELS: Record<IntervalUnit, string> = {
  second: "秒",
  minute: "分钟",
  hour: "小时",
  day: "天",
};
const TYPE_LABELS: Record<TaskType, string> = {
  once: "一次性",
  repeat: "重复",
  interval: "循环",
};

function describeTask(task: Task): string {
  if (task.type === "interval") {
    const unit = task.intervalUnit ? UNIT_LABELS[task.intervalUnit] : "";
    return `每 ${task.intervalValue ?? 0} ${unit}`;
  }
  const time = formatTaskTime(task);
  if (task.type === "once") {
    return task.timeMode === "time" ? time.split(" ")[1] : `${task.year}-${time}`;
  }
  const days = WD_ORDER.filter((day) => task.weekdays.includes(day))
    .map((day) => "周" + WD_LABELS[day])
    .join("、");
  return `${days || "未选日"} ${time.split(" ")[1]}`;
}

function renderTasks() {
  const hasTasks = tasks.length > 0;
  // Optional UI bits — guard so removing any of them from the HTML can't crash.
  if (taskCountEl) taskCountEl.textContent = String(tasks.length);
  if (tasksHeadEl) tasksHeadEl.hidden = !hasTasks;
  if (taskScrollEl) taskScrollEl.hidden = !hasTasks;
  if (homeEmptyEl) homeEmptyEl.hidden = hasTasks;
  if (!taskListEl) return;

  taskListEl.replaceChildren();

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task" + (task.enabled ? "" : " disabled");
    row.innerHTML = `
      <div class="task-time">${describeTask(task)}</div>
      <div class="task-cell enabled">
        <input class="switch" type="checkbox" ${task.enabled ? "checked" : ""} data-toggle="${task.id}" aria-label="${escapeHtml(task.name)}启用状态" />
      </div>
      <div class="task-sub">
        <span class="task-type">${TYPE_LABELS[task.type]}</span>
        <span class="task-name">${escapeHtml(task.name)}</span>
      </div>
      <div class="actions">
        <button class="btn small" type="button" data-preview-task="${task.id}">预览</button>
        <button class="btn small" type="button" data-edit="${task.id}">编辑</button>
        <button class="btn small danger" type="button" data-del="${task.id}">删除</button>
      </div>`;
    taskListEl.appendChild(row);
  }

  taskListEl.querySelectorAll<HTMLInputElement>("[data-toggle]").forEach((element) => {
    element.addEventListener("change", () => {
      const task = tasks.find((item) => item.id === element.dataset.toggle);
      if (!task) return;
      task.enabled = element.checked;
      task.lastFiredFor = undefined;
      persist();
      renderTasks();
      nativeTaskCall("tasks_set_enabled", { id: task.id, enabled: task.enabled });
    });
  });
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((element) => {
    element.addEventListener("click", () => openDialog(element.dataset.edit!));
  });
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.dataset.del!;
      tasks = tasks.filter((item) => item.id !== id);
      persist();
      renderTasks();
      nativeTaskCall("tasks_delete", { id });
      toast("已删除任务");
    });
  });
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-preview-task]").forEach((element) => {
    element.addEventListener("click", () => {
      const task = tasks.find((item) => item.id === element.dataset.previewTask);
      if (task) void openOverlay(task.themeId, true);
    });
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!)
  );
}

// localStorage keeps a mirror of the task list: it is the browser-preview
// store and the one-time migration source for the native scheduler.
function persist() {
  saveTasks(tasks);
}

/* ---------------- Task dialog ---------------- */
let editingId: string | null = null;
let selectedWeekdays = new Set<number>();

function renderWeekdays() {
  weekdaysEl.replaceChildren();
  for (const day of WD_ORDER) {
    const button = document.createElement("div");
    button.className = "wd" + (selectedWeekdays.has(day) ? " on" : "");
    button.textContent = WD_LABELS[day];
    button.addEventListener("click", () => {
      if (selectedWeekdays.has(day)) selectedWeekdays.delete(day);
      else selectedWeekdays.add(day);
      renderWeekdays();
    });
    weekdaysEl.appendChild(button);
  }
}

let currentType: TaskType = "once";
let currentTargetMode: TimeMode = "time";

function setType(type: TaskType) {
  currentType = type;
  typeSegEl.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.type === type));
  });
  if (type === "repeat") currentTargetMode = "time"; // weekday tasks only need a time of day
  syncTypeUI();
}

function setTargetMode(mode: TimeMode) {
  currentTargetMode = mode;
  targetModeSegEl.querySelectorAll<HTMLButtonElement>("[data-target-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.targetMode === mode));
  });
  syncTypeUI();
}

function syncTypeUI() {
  targetRow.hidden = currentType === "interval";
  weekdayRow.hidden = currentType !== "repeat";
  intervalRow.hidden = currentType !== "interval";
  targetModeSegEl.hidden = currentType !== "once"; // time/date toggle only for one-off

  const dateMode = currentType === "once" && currentTargetMode === "date";
  fTime.hidden = dateMode;
  fDateTime.hidden = !dateMode;

  if (currentType === "repeat") {
    timeHintEl.textContent = "在选定的星期几的该时刻触发。";
  } else if (dateMode) {
    timeHintEl.textContent = "选择具体日期与时间，不能早于当前时间。";
  } else {
    timeHintEl.textContent = "将在下一个该时刻触发（今天已过则顺延至明天）。";
  }
}

typeSegEl.querySelectorAll<HTMLButtonElement>("[data-type]").forEach((button) => {
  button.addEventListener("click", () => setType(button.dataset.type as TaskType));
});
targetModeSegEl.querySelectorAll<HTMLButtonElement>("[data-target-mode]").forEach((button) => {
  button.addEventListener("click", () => setTargetMode(button.dataset.targetMode as TimeMode));
});

function timeOfDay(t: { hour: number; minute: number; second: number }): string {
  return `${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)}`;
}

function parseTimeInput(value: string): { hour: number; minute: number; second: number } | null {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = +match[1];
  const minute = +match[2];
  const second = match[3] ? +match[3] : 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

function openDialog(id?: string) {
  editingId = id ?? null;
  const fallback = defaultTaskTime();
  fDateTime.min = toDatetimeLocal(beijingNow());

  if (id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    dialogTitle.textContent = "编辑任务";
    fName.value = task.name;
    fTime.value = timeOfDay(task);
    fDateTime.value = toDatetimeLocal(task);
    fIntervalValue.value = String(task.intervalValue ?? 30);
    fIntervalUnit.value = task.intervalUnit ?? "minute";
    selectedWeekdays = new Set(task.weekdays);
    selectedThemeId = task.themeId;
    currentTargetMode = task.type === "once" ? task.timeMode ?? "date" : "time";
    setType(task.type);
  } else {
    dialogTitle.textContent = "新建任务";
    fName.value = "";
    fTime.value = timeOfDay(fallback);
    fDateTime.value = toDatetimeLocal(fallback);
    fIntervalValue.value = "30";
    fIntervalUnit.value = "minute";
    selectedWeekdays = new Set();
    selectedThemeId = THEME_META[0].id;
    currentTargetMode = "time";
    setType("once");
  }
  setTargetMode(currentTargetMode);
  renderWeekdays();
  syncThemePicker();
  clearDialogError();
  goToStep(0, true);
  openModal();
}

function openModal() {
  modal.hidden = false;
  // next frame so the CSS transition runs
  requestAnimationFrame(() => modal.classList.add("open"));
  requestAnimationFrame(() => wizardNextBtn.focus());
}

function closeModal() {
  modal.classList.remove("open");
  modal.hidden = true;
}

function showDialogError(message: string) {
  dialogErrorEl.textContent = message;
  dialogErrorEl.hidden = false;
}

function clearDialogError() {
  dialogErrorEl.textContent = "";
  dialogErrorEl.hidden = true;
}

interface TimingResult {
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  timeMode?: TimeMode;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  intervalAnchor?: number;
}

/** Validate the step-1 timing inputs. Shows a dialog error and returns null on failure. */
function computeTiming(): TimingResult | null {
  const type = currentType;

  if (type === "interval") {
    const value = Math.floor(Number(fIntervalValue.value));
    if (!Number.isFinite(value) || value < 1) {
      showDialogError("请填写有效的循环间隔");
      return null;
    }
    return {
      wall: beijingNow(),
      intervalValue: value,
      intervalUnit: fIntervalUnit.value as IntervalUnit,
      intervalAnchor: Date.now(),
    };
  }

  if (type === "repeat") {
    const tod = parseTimeInput(fTime.value);
    if (!tod) {
      showDialogError("请填写有效的时间");
      return null;
    }
    if (selectedWeekdays.size === 0) {
      showDialogError("重复任务请至少选择一个星期几");
      return null;
    }
    const base = beijingNow();
    return { wall: { year: base.year, month: base.month, day: base.day, ...tod } };
  }

  if (currentTargetMode === "time") {
    const tod = parseTimeInput(fTime.value);
    if (!tod) {
      showDialogError("请填写有效的时间");
      return null;
    }
    return { wall: nextOccurrence(tod.hour, tod.minute, tod.second), timeMode: "time" };
  }

  const parsed = parseDatetimeLocal(fDateTime.value);
  if (!parsed) {
    showDialogError("请填写有效的目标时间");
    return null;
  }
  const epoch = beijingWallToEpoch(
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second
  );
  if (epoch < Date.now()) {
    showDialogError("目标时间不能早于当前时间");
    return null;
  }
  return { wall: parsed, timeMode: "date" };
}

function submitTask() {
  clearDialogError();
  const timing = computeTiming();
  if (!timing) {
    goToStep(0); // send the user back to fix the timing
    return;
  }
  const { wall } = timing;

  const task: Task = {
    id: editingId ?? uid(),
    name: fName.value.trim() || "未命名任务",
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
    type: currentType,
    weekdays: [...selectedWeekdays].sort(),
    timeMode: timing.timeMode,
    intervalValue: timing.intervalValue,
    intervalUnit: timing.intervalUnit,
    intervalAnchor: timing.intervalAnchor,
    themeId: selectedThemeId,
    enabled: true,
    lastFiredFor: undefined,
  };

  if (editingId) tasks = tasks.map((item) => (item.id === editingId ? task : item));
  else tasks.push(task);
  persist();
  renderTasks();
  nativeTaskCall("tasks_upsert", { task });
  closeModal();
  toast(editingId ? "已保存修改" : "已创建任务");
}

/* ---------------- Wizard step navigation ---------------- */
const WIZARD_SUBS = [
  "选择任务类型与触发时间",
  "挑选一个倒计时动画效果",
  "给任务起个名字（可跳过）",
];
const WIZARD_LAST = 2;
let currentStep = 0;

function summarizeTiming(): string {
  if (currentType === "interval") {
    const unit = UNIT_LABELS[fIntervalUnit.value as IntervalUnit];
    return `每 ${fIntervalValue.value} ${unit} 执行一次`;
  }
  if (currentType === "repeat") {
    const days = WD_ORDER.filter((day) => selectedWeekdays.has(day))
      .map((day) => "周" + WD_LABELS[day])
      .join("、");
    return `${days || "未选日"} ${fTime.value}`;
  }
  return currentTargetMode === "time" ? `每天 ${fTime.value}` : fDateTime.value.replace("T", " ");
}

function refreshSummary() {
  wizardSummaryEl.innerHTML = `
    <div>类型：<strong>${TYPE_LABELS[currentType]}</strong></div>
    <div>触发：<strong>${escapeHtml(summarizeTiming())}</strong></div>
    <div>动画：<strong>${escapeHtml(themeName(selectedThemeId))}</strong></div>`;
}

function goToStep(step: number, immediate = false) {
  currentStep = Math.max(0, Math.min(WIZARD_LAST, step));
  clearDialogError();

  const track = wizardTrackEl;
  if (immediate) {
    const prev = track.style.transition;
    track.style.transition = "none";
    track.style.transform = `translateX(-${currentStep * 100}%)`;
    // force reflow so the next transition re-enables cleanly
    void track.offsetWidth;
    track.style.transition = prev;
  } else {
    track.style.transform = `translateX(-${currentStep * 100}%)`;
  }

  wizardStepsEl.querySelectorAll<HTMLElement>("li").forEach((li, index) => {
    li.classList.toggle("done", index < currentStep);
    if (index === currentStep) li.setAttribute("aria-current", "step");
    else li.removeAttribute("aria-current");
  });

  wizardSubEl.textContent = WIZARD_SUBS[currentStep];
  wizardBackBtn.hidden = currentStep === 0;
  const onLast = currentStep === WIZARD_LAST;
  wizardNextBtn.hidden = onLast;
  saveTaskBtn.hidden = !onLast;
  if (onLast) refreshSummary();
}

function nextStep() {
  if (currentStep === 0 && !computeTiming()) return; // block until timing valid
  goToStep(currentStep + 1);
}

document.getElementById("addTask")!.addEventListener("click", () => openDialog());
document.getElementById("cancelDialog")!.addEventListener("click", () => closeModal());
wizardNextBtn.addEventListener("click", () => nextStep());
wizardBackBtn.addEventListener("click", () => goToStep(currentStep - 1));
saveTaskBtn.addEventListener("click", () => submitTask());

// Enter advances (or saves on the last step); Escape closes.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (currentStep === WIZARD_LAST) submitTask();
  else nextStep();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

/* ---------------- Scheduler bridge ----------------
   Native builds: Rust owns the task list, the recurrence math, firing,
   persistence and the lock/sleep pause semantics. The webview only mirrors
   UI edits into Rust and pulls the authoritative list back for display. */

function applyNativeTasks(list: Task[]) {
  tasks = list;
  saveTasks(tasks);
  renderTasks();
}

function nativeTaskCall(command: string, args: Record<string, unknown> = {}) {
  if (!isTauri) return;
  void invoke<Task[]>(command, args)
    .then(applyNativeTasks)
    .catch((error) => console.warn(`Scheduler command ${command} failed:`, error));
}

function syncNativeSettings() {
  if (!isTauri) return;
  void invoke("scheduler_set_settings", {
    settings: {
      leadSecs: settings.countdownSeconds,
      soundOn: settings.soundOn,
      showDigits: settings.showDigits,
    },
  }).catch((error) => console.warn("Unable to sync scheduler settings:", error));
}

// Browser-only fallback. Native builds use the Rust scheduler above.
let lastSchedulerCheckAt = Date.now();

function schedulerTick() {
  const now = Date.now();
  const checkedFrom = now >= lastSchedulerCheckAt ? lastSchedulerCheckAt : now;
  lastSchedulerCheckAt = now;
  let changed = false;
  for (const task of tasks) {
    if (!task.enabled) continue;
    const fireAt = nextFireEpoch(task, settings.countdownSeconds, checkedFrom);
    if (fireAt == null) continue;
    if (task.type === "once" && fireAt <= checkedFrom) {
      task.enabled = false;
      changed = true;
      continue;
    }
    if (crossedEpoch(fireAt, checkedFrom, now) && task.lastFiredFor !== fireAt) {
      task.lastFiredFor = fireAt;
      changed = true;
      void openOverlay(task.themeId, false);
      toast(`触发任务：${task.name}`);
      if (task.type === "once") task.enabled = false;
    }
  }
  if (changed) {
    persist();
    renderTasks();
  }
}
if (!isTauri) setInterval(schedulerTick, 500);

/* ---------------- Init ---------------- */
buildThemePicker();
renderTasks();
showView(viewFromHash(), false);

if (isTauri) {
  void listen(EVENT_FINISHED, () => {
    void restoreFromBall();
    toast("倒计时结束，已返回控制台");
  });
  void listen<SchedulerFiredPayload>(EVENT_SCHEDULE_FIRED, ({ payload }) => {
    const name = tasks.find((item) => item.id === payload.taskId)?.name ?? "任务";
    // Rust already updated its own state; just mirror it for display.
    nativeTaskCall("tasks_all");
    toast(
      payload.skipped
        ? `已跳过暂停期间错过的任务：${name}`
        : payload.opened
          ? `触发任务：${name}`
          : `任务触发失败：${name}`
    );
  });
  void listen<boolean>(EVENT_SCHEDULE_PAUSE, ({ payload }) => {
    if (!payload) toast("已解锁，任务调度已恢复");
  });

  // Adopt the persisted native task list (first run migrates the localStorage
  // list), then hand the scheduler the current settings.
  nativeTaskCall("tasks_bootstrap", { tasks });
  syncNativeSettings();

  // UI self-heal: mirror the native state even if a fired event was missed
  // while this window's webview was frozen.
  window.setInterval(() => nativeTaskCall("tasks_all"), 30_000);
}
