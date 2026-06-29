import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { THEME_META, themeName, type ThemeMeta } from "../shared/themes-meta";
import {
  loadSettings,
  loadTasks,
  saveSettings,
  saveTasks,
  uid,
  writeOverlayConfig,
} from "../shared/storage";
import { AppSettings, EVENT_FINISHED, Task, TRIGGER_LEAD_SECONDS } from "../shared/types";
import {
  beijingNow,
  crossedEpoch,
  defaultTaskTime,
  formatTaskTime,
  nextFireEpoch,
  parseDatetimeLocal,
  toDatetimeLocal,
} from "../shared/time";

const isTauri = "__TAURI_INTERNALS__" in window;
const pad = (n: number) => String(n).padStart(2, "0");

let tasks: Task[] = loadTasks();
let settings: AppSettings = loadSettings();

type ViewName = "home" | "themes" | "settings";

/* ---------------- DOM refs ---------------- */
const clockDateEl = document.getElementById("clockDate") as HTMLElement;
const clockTimeEl = document.getElementById("clockTime") as HTMLElement;
const soundToggle = document.getElementById("soundToggle") as HTMLInputElement;
const settingsSoundToggle = document.getElementById("settingsSoundToggle") as HTMLInputElement;
const soundLabel = document.getElementById("soundLabel") as HTMLElement;
const taskTableEl = document.getElementById("taskTable") as HTMLElement;
const taskListEl = document.getElementById("taskList") as HTMLElement;
const taskCountEl = document.getElementById("taskCount") as HTMLElement;
const emptyTasksEl = document.getElementById("emptyTasks") as HTMLElement;
const themeViewportEl = document.getElementById("themeViewport") as HTMLElement;
const themeCanvasEl = document.getElementById("themeVirtualCanvas") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

const dialog = document.getElementById("taskDialog") as HTMLDialogElement;
const form = document.getElementById("taskForm") as HTMLFormElement;
const dialogTitle = document.getElementById("dialogTitle") as HTMLElement;
const fName = document.getElementById("f_name") as HTMLInputElement;
const fTime = document.getElementById("f_time") as HTMLInputElement;
const fTheme = document.getElementById("f_theme") as HTMLSelectElement;
const weekdayRow = document.getElementById("weekdayRow") as HTMLElement;
const weekdaysEl = document.getElementById("weekdays") as HTMLElement;

/* ---------------- Status toast ---------------- */
let statusTimer = 0;
function toast(message: string) {
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

/* ---------------- Beijing clock ---------------- */
const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function tickClock() {
  const now = beijingNow();
  clockDateEl.textContent = `${now.year}年${pad(now.month)}月${pad(now.day)}日  ${WEEKDAYS[now.weekday]}`;
  clockTimeEl.textContent = `${pad(now.hour)}:${pad(now.minute)}:${pad(now.second)}`;
}
setInterval(tickClock, 200);
tickClock();

/* ---------------- Appearance and sound ---------------- */
function renderAppearance() {
  document.documentElement.dataset.theme = settings.colorMode;
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === settings.colorMode));
  });
}

function setColorMode(mode: AppSettings["colorMode"]) {
  if (settings.colorMode === mode) return;
  settings.colorMode = mode;
  saveSettings(settings);
  renderAppearance();
  toast(mode === "dark" ? "已切换为深色主题" : "已切换为浅色主题");
}

document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
  button.addEventListener("click", () => setColorMode(button.dataset.themeChoice as AppSettings["colorMode"]));
});

function renderSound() {
  soundToggle.checked = settings.soundOn;
  settingsSoundToggle.checked = settings.soundOn;
  soundLabel.textContent = settings.soundOn ? "音效 开" : "音效 关";
}

function setSound(enabled: boolean) {
  settings.soundOn = enabled;
  saveSettings(settings);
  renderSound();
}

soundToggle.addEventListener("change", () => setSound(soundToggle.checked));
settingsSoundToggle.addEventListener("change", () => setSound(settingsSoundToggle.checked));

renderAppearance();
renderSound();

/* ---------------- Open overlay (preview / real) ---------------- */
async function openOverlay(themeId: string, preview: boolean) {
  writeOverlayConfig({ themeId, soundOn: settings.soundOn, preview });
  if (!isTauri) {
    window.open("/overlay.html", "_blank", "noopener");
    return;
  }
  try {
    await invoke("show_overlay");
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

function describeTask(task: Task): string {
  const time = formatTaskTime(task);
  if (task.type === "once") return `${task.year}-${time}`;
  const days = WD_ORDER.filter((day) => task.weekdays.includes(day))
    .map((day) => "周" + WD_LABELS[day])
    .join("、");
  return `${days || "未选日"} ${time.split(" ")[1]}`;
}

function renderTasks() {
  taskListEl.replaceChildren();
  taskCountEl.textContent = String(tasks.length);
  taskTableEl.hidden = tasks.length === 0;
  emptyTasksEl.hidden = tasks.length > 0;

  for (const task of tasks) {
    const row = document.createElement("div");
    row.className = "task" + (task.enabled ? "" : " disabled");
    row.innerHTML = `
      <div class="task-name">${escapeHtml(task.name)}</div>
      <div class="task-cell time"><strong>${describeTask(task)}</strong></div>
      <div class="task-cell repeat"><span class="tag">${task.type === "repeat" ? "重复" : "一次性"}</span></div>
      <div class="task-cell theme">${themeName(task.themeId)}</div>
      <div class="task-cell enabled">
        <input class="switch" type="checkbox" ${task.enabled ? "checked" : ""} data-toggle="${task.id}" aria-label="${escapeHtml(task.name)}启用状态" />
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

function currentType(): "once" | "repeat" {
  const radio = form.querySelector<HTMLInputElement>('input[name="ttype"]:checked');
  return (radio?.value as "once" | "repeat") ?? "once";
}

function syncTypeUI() {
  weekdayRow.hidden = currentType() !== "repeat";
}

form.querySelectorAll<HTMLInputElement>('input[name="ttype"]').forEach((radio) => {
  radio.addEventListener("change", syncTypeUI);
});

function openDialog(id?: string) {
  editingId = id ?? null;
  if (id) {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    dialogTitle.textContent = "编辑任务";
    fName.value = task.name;
    fTime.value = toDatetimeLocal(task);
    (form.querySelector(`input[name="ttype"][value="${task.type}"]`) as HTMLInputElement).checked = true;
    selectedWeekdays = new Set(task.weekdays);
    fTheme.value = task.themeId;
  } else {
    dialogTitle.textContent = "新建任务";
    fName.value = "";
    fTime.value = toDatetimeLocal(defaultTaskTime());
    (form.querySelector('input[name="ttype"][value="once"]') as HTMLInputElement).checked = true;
    selectedWeekdays = new Set();
    fTheme.value = THEME_META[0].id;
  }
  syncTypeUI();
  renderWeekdays();
  dialog.showModal();
}

document.getElementById("addTask")!.addEventListener("click", () => openDialog());
document.getElementById("cancelDialog")!.addEventListener("click", () => dialog.close());

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const wall = parseDatetimeLocal(fTime.value);
  if (!wall) {
    toast("请填写有效的目标时间");
    return;
  }
  const type = currentType();
  if (type === "repeat" && selectedWeekdays.size === 0) {
    toast("重复任务请至少选择一个星期几");
    return;
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
    themeId: fTheme.value,
    enabled: true,
    lastFiredFor: undefined,
  };

  if (editingId) tasks = tasks.map((item) => (item.id === editingId ? task : item));
  else tasks.push(task);
  persist();
  renderTasks();
  dialog.close();
  toast(editingId ? "已保存修改" : "已创建任务");
});

/* ---------------- Scheduler ---------------- */
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
setInterval(schedulerTick, 500);

/* ---------------- Init ---------------- */
fillThemeSelect();
renderTasks();
showView(viewFromHash(), false);

if (isTauri) {
  void listen(EVENT_FINISHED, () => toast("倒计时结束，已返回控制台"));
}
