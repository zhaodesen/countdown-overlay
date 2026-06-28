import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { THEME_META, themeName } from "../shared/themes-meta";
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
  formatClock,
  formatTaskTime,
  nextFireEpoch,
  parseDatetimeLocal,
  toDatetimeLocal,
} from "../shared/time";

const isTauri = "__TAURI_INTERNALS__" in window;

let tasks: Task[] = loadTasks();
let settings: AppSettings = loadSettings();

/* ---------------- DOM refs ---------------- */
const clockEl = document.getElementById("clock") as HTMLElement;
const soundToggle = document.getElementById("soundToggle") as HTMLInputElement;
const soundLabel = document.getElementById("soundLabel") as HTMLElement;
const taskListEl = document.getElementById("taskList") as HTMLElement;
const emptyTasksEl = document.getElementById("emptyTasks") as HTMLElement;
const themeGridEl = document.getElementById("themeGrid") as HTMLElement;
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
function toast(msg: string) {
  statusEl.textContent = msg;
  statusEl.classList.add("show");
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => statusEl.classList.remove("show"), 3000);
}

/* ---------------- Beijing clock ---------------- */
function tickClock() {
  clockEl.textContent = formatClock(beijingNow());
}
setInterval(tickClock, 200);
tickClock();

/* ---------------- Sound toggle ---------------- */
function renderSound() {
  soundToggle.checked = settings.soundOn;
  soundLabel.textContent = settings.soundOn ? "音效 开" : "音效 关";
}
soundToggle.addEventListener("change", () => {
  settings.soundOn = soundToggle.checked;
  saveSettings(settings);
  renderSound();
});
renderSound();

/* ---------------- Open overlay (preview / real) ---------------- */
async function openOverlay(themeId: string, preview: boolean) {
  writeOverlayConfig({ themeId, soundOn: settings.soundOn, preview });
  if (!isTauri) {
    // Browser preview: just open the overlay page in a new tab.
    window.open("/overlay.html", "_blank", "noopener");
    return;
  }
  try {
    await invoke("show_overlay");
  } catch (err) {
    toast(`无法打开 Overlay：${String(err)}`);
  }
}

/* ---------------- Theme grid ---------------- */
function renderThemes() {
  const heading = document.getElementById("themeHeading");
  if (heading) heading.textContent = `动画效果 · ${THEME_META.length} 款`;
  themeGridEl.innerHTML = "";
  for (const t of THEME_META) {
    const card = document.createElement("div");
    card.className = "theme-card";
    card.innerHTML = `
      <div class="theme-swatch" style="background:linear-gradient(135deg, ${t.swatch[0]}, ${t.swatch[1]})">5</div>
      <div class="theme-body">
        <div><span class="theme-name">${t.name}</span><span class="theme-cat">${t.category}</span></div>
        <div class="theme-blurb">${t.blurb}</div>
        <button class="btn small primary" data-preview="${t.id}">预览</button>
      </div>`;
    themeGridEl.appendChild(card);
  }
  themeGridEl.querySelectorAll<HTMLButtonElement>("[data-preview]").forEach((b) => {
    b.addEventListener("click", () => {
      void openOverlay(b.dataset.preview as string, true);
      toast(`预览：${themeName(b.dataset.preview as string)}`);
    });
  });
}

/* populate theme <select> in the dialog */
function fillThemeSelect() {
  fTheme.innerHTML = "";
  for (const t of THEME_META) {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = `${t.name} · ${t.category}`;
    fTheme.appendChild(o);
  }
}

/* ---------------- Task list ---------------- */
const WD_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun

function describeTask(t: Task): string {
  const time = formatTaskTime(t);
  if (t.type === "once") {
    return `${t.year}-${time}`;
  }
  const days = WD_ORDER.filter((d) => t.weekdays.includes(d))
    .map((d) => "周" + WD_LABELS[d])
    .join(" ");
  const hms = time.split(" ")[1];
  return `${days || "未选日"} · ${hms}`;
}

function renderTasks() {
  taskListEl.innerHTML = "";
  emptyTasksEl.style.display = tasks.length ? "none" : "block";
  for (const t of tasks) {
    const row = document.createElement("div");
    row.className = "task" + (t.enabled ? "" : " disabled");
    const tagClass = t.type === "repeat" ? "tag repeat" : "tag";
    const tagText = t.type === "repeat" ? "重复" : "一次性";
    row.innerHTML = `
      <input class="switch" type="checkbox" ${t.enabled ? "checked" : ""} data-toggle="${t.id}" />
      <div class="info">
        <div class="name">${escapeHtml(t.name)}</div>
        <div class="meta">
          <span class="${tagClass}">${tagText}</span>
          ${describeTask(t)} · 动画：${themeName(t.themeId)}
        </div>
      </div>
      <div class="actions">
        <button class="btn small" data-preview-task="${t.id}">预览</button>
        <button class="btn small" data-edit="${t.id}">编辑</button>
        <button class="btn small danger" data-del="${t.id}">删除</button>
      </div>`;
    taskListEl.appendChild(row);
  }

  taskListEl.querySelectorAll<HTMLInputElement>("[data-toggle]").forEach((el) =>
    el.addEventListener("change", () => {
      const t = tasks.find((x) => x.id === el.dataset.toggle);
      if (!t) return;
      t.enabled = el.checked;
      t.lastFiredFor = undefined;
      persist();
      renderTasks();
    })
  );
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((el) =>
    el.addEventListener("click", () => openDialog(el.dataset.edit!))
  );
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((el) =>
    el.addEventListener("click", () => {
      tasks = tasks.filter((x) => x.id !== el.dataset.del);
      persist();
      renderTasks();
      toast("已删除任务");
    })
  );
  taskListEl.querySelectorAll<HTMLButtonElement>("[data-preview-task]").forEach((el) =>
    el.addEventListener("click", () => {
      const t = tasks.find((x) => x.id === el.dataset.previewTask);
      if (t) void openOverlay(t.themeId, true);
    })
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

function persist() {
  saveTasks(tasks);
}

/* ---------------- Task dialog ---------------- */
let editingId: string | null = null;
let selectedWeekdays = new Set<number>();

function renderWeekdays() {
  weekdaysEl.innerHTML = "";
  for (const d of WD_ORDER) {
    const b = document.createElement("div");
    b.className = "wd" + (selectedWeekdays.has(d) ? " on" : "");
    b.textContent = WD_LABELS[d];
    b.addEventListener("click", () => {
      if (selectedWeekdays.has(d)) selectedWeekdays.delete(d);
      else selectedWeekdays.add(d);
      renderWeekdays();
    });
    weekdaysEl.appendChild(b);
  }
}

function currentType(): "once" | "repeat" {
  const r = form.querySelector<HTMLInputElement>('input[name="ttype"]:checked');
  return (r?.value as "once" | "repeat") ?? "once";
}

function syncTypeUI() {
  weekdayRow.hidden = currentType() !== "repeat";
}

form.querySelectorAll<HTMLInputElement>('input[name="ttype"]').forEach((r) =>
  r.addEventListener("change", syncTypeUI)
);

function openDialog(id?: string) {
  editingId = id ?? null;
  if (id) {
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    dialogTitle.textContent = "编辑任务";
    fName.value = t.name;
    fTime.value = toDatetimeLocal(t);
    (form.querySelector(`input[name="ttype"][value="${t.type}"]`) as HTMLInputElement).checked = true;
    selectedWeekdays = new Set(t.weekdays);
    fTheme.value = t.themeId;
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

form.addEventListener("submit", (e) => {
  e.preventDefault();
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

  const base: Task = {
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

  if (editingId) {
    tasks = tasks.map((t) => (t.id === editingId ? base : t));
  } else {
    tasks.push(base);
  }
  persist();
  renderTasks();
  dialog.close();
  toast(editingId ? "已保存修改" : "已创建任务");
});

/* ---------------- Scheduler ---------------- */
// Track the interval between scheduler runs instead of relying on a narrow
// wall-clock window. If the webview timer is throttled or the machine sleeps,
// the first tick after resume still observes that the trigger point was
// crossed. Starting from the current instant intentionally avoids replaying
// tasks that expired while the application was not running.
let lastSchedulerCheckAt = Date.now();

function schedulerTick() {
  const now = Date.now();
  const checkedFrom = now >= lastSchedulerCheckAt ? lastSchedulerCheckAt : now;
  lastSchedulerCheckAt = now;
  let changed = false;
  for (const t of tasks) {
    if (!t.enabled) continue;
    const fireAt = nextFireEpoch(t, TRIGGER_LEAD_SECONDS, checkedFrom);
    if (fireAt == null) continue;

    // A one-shot that was already stale when this polling interval started
    // must not remain enabled forever or replay after an application restart.
    if (t.type === "once" && fireAt <= checkedFrom) {
      t.enabled = false;
      changed = true;
      continue;
    }

    if (crossedEpoch(fireAt, checkedFrom, now) && t.lastFiredFor !== fireAt) {
      t.lastFiredFor = fireAt;
      changed = true;
      void openOverlay(t.themeId, false);
      toast(`触发任务：${t.name}`);
      if (t.type === "once") t.enabled = false; // one-shot disables itself
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
renderThemes();
renderTasks();

void listen(EVENT_FINISHED, () => toast("倒计时结束，已返回控制台"));
