import { invoke } from "@tauri-apps/api/core";
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
  SchedulerFiredPayload,
  IntervalUnit,
  Task,
  TaskType,
  TimeMode,
  TRIGGER_LEAD_SECONDS,
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

let tasks: Task[] = loadTasks();
let settings: AppSettings = loadSettings();

type ViewName = "home" | "themes" | "settings";

/* ---------------- DOM refs ---------------- */
const clockTimeEl = document.getElementById("clockTime") as HTMLElement;
const themeToggle = document.getElementById("themeToggle") as HTMLButtonElement;
const soundToggle = document.getElementById("soundToggle") as HTMLButtonElement;
const settingsSoundToggle = document.getElementById("settingsSoundToggle") as HTMLInputElement;
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
const fTheme = document.getElementById("f_theme") as HTMLSelectElement;
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
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === settings.colorMode));
  });
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

document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => setColorMode(button.dataset.themeChoice as AppSettings["colorMode"]));
});
themeToggle.addEventListener("click", () => setColorMode(settings.colorMode === "dark" ? "light" : "dark"));

function renderSound() {
  const soundAction = settings.soundOn ? "关闭音效" : "开启音效";
  soundToggle.dataset.enabled = String(settings.soundOn);
  soundToggle.setAttribute("aria-pressed", String(settings.soundOn));
  soundToggle.setAttribute("aria-label", soundAction);
  soundToggle.title = soundAction;
  settingsSoundToggle.checked = settings.soundOn;
}

function setSound(enabled: boolean) {
  settings.soundOn = enabled;
  saveSettings(settings);
  renderSound();
  if (syncNativeScheduler()) renderTasks();
}

soundToggle.addEventListener("click", () => setSound(!settings.soundOn));
settingsSoundToggle.addEventListener("change", () => setSound(settingsSoundToggle.checked));

renderAppearance();
syncNativeTheme();
renderSound();

/* ---------------- Open overlay (preview / real) ---------------- */
async function openOverlay(themeId: string, preview: boolean) {
  writeOverlayConfig({ themeId, soundOn: settings.soundOn, preview });
  if (!isTauri) {
    window.open("/overlay.html", "_blank", "noopener");
    return;
  }
  try {
    await invoke("show_overlay", {
      themeId,
      soundOn: settings.soundOn,
      preview,
    });
  } catch (error) {
    toast(`无法打开 Overlay：${String(error)}`);
  }
}

/* ---------------- Virtual animation library ---------------- */
const VIRTUAL_GAP = 16;
const VIRTUAL_ROW_HEIGHT = 306;
let virtualFrame = 0;
let virtualSignature = "";

function virtualColumnCount(width: number): number {
  if (width >= 1120) return 3;
  if (width >= 720) return 2;
  return 1;
}

function themeCard(theme: ThemeMeta, width: number, left: number, top: number): HTMLElement {
  const card = document.createElement("article");
  card.className = "theme-card";
  card.dataset.themeId = theme.id;
  card.style.width = `${width}px`;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
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

  const fragment = document.createDocumentFragment();
  for (let index = startRow * columns; index < Math.min(THEME_META.length, endRow * columns); index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    fragment.appendChild(
      themeCard(
        THEME_META[index],
        cardWidth,
        column * (cardWidth + VIRTUAL_GAP),
        row * VIRTUAL_ROW_HEIGHT
      )
    );
  }
  themeCanvasEl.replaceChildren(fragment);
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

/* populate theme <select> in the dialog */
function fillThemeSelect() {
  fTheme.replaceChildren();
  for (const theme of THEME_META) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = `${theme.name} · ${theme.category}`;
    fTheme.appendChild(option);
  }
}

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
    });
  });
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((element) => {
    element.addEventListener("click", () => openDialog(element.dataset.edit!));
  });
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((element) => {
    element.addEventListener("click", () => {
      tasks = tasks.filter((item) => item.id !== element.dataset.del);
      persist();
      renderTasks();
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

function persist() {
  saveTasks(tasks);
  syncNativeScheduler();
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
    fTheme.value = task.themeId;
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
    fTheme.value = THEME_META[0].id;
    currentTargetMode = "time";
    setType("once");
  }
  setTargetMode(currentTargetMode);
  renderWeekdays();
  clearDialogError();
  openModal();
}

function openModal() {
  modal.hidden = false;
  // next frame so the CSS transition runs
  requestAnimationFrame(() => modal.classList.add("open"));
  requestAnimationFrame(() => fName.focus());
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

function submitTask() {
  clearDialogError();
  const type = currentType;

  let wall: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  let timeMode: TimeMode | undefined;
  let intervalValue: number | undefined;
  let intervalUnit: IntervalUnit | undefined;
  let intervalAnchor: number | undefined;

  if (type === "interval") {
    const value = Math.floor(Number(fIntervalValue.value));
    if (!Number.isFinite(value) || value < 1) {
      showDialogError("请填写有效的循环间隔");
      return;
    }
    intervalValue = value;
    intervalUnit = fIntervalUnit.value as IntervalUnit;
    intervalAnchor = Date.now();
    wall = beijingNow();
  } else if (type === "repeat") {
    const tod = parseTimeInput(fTime.value);
    if (!tod) {
      showDialogError("请填写有效的时间");
      return;
    }
    if (selectedWeekdays.size === 0) {
      showDialogError("重复任务请至少选择一个星期几");
      return;
    }
    const base = beijingNow();
    wall = { year: base.year, month: base.month, day: base.day, ...tod };
  } else if (currentTargetMode === "time") {
    const tod = parseTimeInput(fTime.value);
    if (!tod) {
      showDialogError("请填写有效的时间");
      return;
    }
    wall = nextOccurrence(tod.hour, tod.minute, tod.second);
    timeMode = "time";
  } else {
    const parsed = parseDatetimeLocal(fDateTime.value);
    if (!parsed) {
      showDialogError("请填写有效的目标时间");
      return;
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
      return;
    }
    wall = parsed;
    timeMode = "date";
  }

  const task: Task = {
    id: editingId ?? uid(),
    name: fName.value.trim() || "未命名任务",
    year: wall.year,
    month: wall.month,
    day: wall.day,
    hour: wall.hour,
    minute: wall.minute,
    second: wall.second,
    type,
    weekdays: [...selectedWeekdays].sort(),
    timeMode,
    intervalValue,
    intervalUnit,
    intervalAnchor,
    themeId: fTheme.value,
    enabled: true,
    lastFiredFor: undefined,
  };

  if (editingId) tasks = tasks.map((item) => (item.id === editingId ? task : item));
  else tasks.push(task);
  persist();
  renderTasks();
  closeModal();
  toast(editingId ? "已保存修改" : "已创建任务");
}

document.getElementById("addTask")!.addEventListener("click", () => openDialog());
document.getElementById("cancelDialog")!.addEventListener("click", () => closeModal());
document.getElementById("saveTask")!.addEventListener("click", () => submitTask());

// Enter saves, Escape closes — no reliance on native <dialog> behaviour.
form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitTask();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modal.hidden) closeModal();
});

/* ---------------- Scheduler ---------------- */
interface NativeScheduleEntry {
  taskId: string;
  fireAtMs: number;
  themeId: string;
  soundOn: boolean;
}

function syncNativeScheduler(): boolean {
  if (!isTauri) return false;

  const now = Date.now();
  const entries: NativeScheduleEntry[] = [];
  let normalized = false;

  for (const task of tasks) {
    if (!task.enabled) continue;
    let fireAt = nextFireEpoch(task, TRIGGER_LEAD_SECONDS, now);
    if (fireAt == null) continue;

    if (task.type === "once" && fireAt <= now) {
      task.enabled = false;
      normalized = true;
      continue;
    }

    if (task.type === "repeat" && task.lastFiredFor === fireAt) {
      fireAt = nextFireEpoch(task, TRIGGER_LEAD_SECONDS, fireAt + 1501);
      if (fireAt == null) continue;
    }

    entries.push({
      taskId: task.id,
      fireAtMs: fireAt,
      themeId: task.themeId,
      soundOn: settings.soundOn,
    });
  }

  if (normalized) saveTasks(tasks);
  void invoke("sync_scheduler", { entries }).catch((error) => {
    console.warn("Unable to sync native scheduler:", error);
  });
  return normalized;
}

// Browser-only fallback. Native builds use the Rust deadline scheduler below.
let lastSchedulerCheckAt = Date.now();

function schedulerTick() {
  const now = Date.now();
  const checkedFrom = now >= lastSchedulerCheckAt ? lastSchedulerCheckAt : now;
  lastSchedulerCheckAt = now;
  let changed = false;
  for (const task of tasks) {
    if (!task.enabled) continue;
    const fireAt = nextFireEpoch(task, TRIGGER_LEAD_SECONDS, checkedFrom);
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
fillThemeSelect();
renderTasks();
showView(viewFromHash(), false);

if (isTauri) {
  void listen(EVENT_FINISHED, () => toast("倒计时结束，已返回控制台"));
  void listen<SchedulerFiredPayload>(EVENT_SCHEDULE_FIRED, ({ payload }) => {
    const task = tasks.find((item) => item.id === payload.taskId);
    if (!task) return;
    task.lastFiredFor = payload.fireAtMs;
    if (task.type === "once") task.enabled = false;
    persist();
    renderTasks();
    toast(payload.opened ? `触发任务：${task.name}` : `任务触发失败：${task.name}`);
  }).then(() => {
    if (syncNativeScheduler()) renderTasks();
  });
}
