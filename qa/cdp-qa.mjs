import fs from "node:fs/promises";
import path from "node:path";

const endpoint = "http://127.0.0.1:9333";
const outDir = path.resolve("qa");
await fs.mkdir(outDir, { recursive: true });

const tabs = await fetch(`${endpoint}/json/list`).then((response) => response.json());
const tab = tabs.find((item) => item.type === "page");
if (!tab) throw new Error("未找到可调试页面");

const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let requestId = 0;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails.text);
  }
});

function send(method, params = {}) {
  const id = ++requestId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function capture(name) {
  const result = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await fs.writeFile(path.join(outDir, name), Buffer.from(result.data, "base64"));
}

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 1024,
  deviceScaleFactor: 1,
  mobile: false,
});

const sampleTasks = [
  {
    id: "qa-release",
    name: "项目发布",
    year: 2026,
    month: 7,
    day: 2,
    hour: 10,
    minute: 0,
    second: 0,
    type: "once",
    weekdays: [],
    themeId: "cyberpunk",
    enabled: true,
  },
  {
    id: "qa-meeting",
    name: "客户会议",
    year: 2026,
    month: 7,
    day: 6,
    hour: 14,
    minute: 30,
    second: 0,
    type: "repeat",
    weekdays: [1],
    themeId: "ink",
    enabled: true,
  },
  {
    id: "qa-review",
    name: "每日复盘",
    year: 2026,
    month: 7,
    day: 1,
    hour: 18,
    minute: 0,
    second: 0,
    type: "repeat",
    weekdays: [1, 2, 3, 4, 5],
    themeId: "frost",
    enabled: false,
  },
];

await evaluate(`(() => {
  localStorage.setItem("co.tasks.v1", ${JSON.stringify(JSON.stringify(sampleTasks))});
  localStorage.setItem("co.settings.v1", JSON.stringify({ soundOn: true, colorMode: "dark" }));
  location.hash = "#home";
  location.reload();
})()`);
await sleep(1400);
await capture("home-dark.png");

await evaluate(`document.querySelector('[data-theme-choice="light"]').click()`);
await sleep(250);
await capture("home-light.png");

await evaluate(`document.querySelector('[data-theme-choice="dark"]').click(); document.querySelector('[data-view="themes"]').click()`);
await sleep(1400);
await capture("themes-dark.png");

const wideVirtual = await evaluate(`(() => ({
  total: 11,
  rendered: document.querySelectorAll('[data-theme-id]').length,
  ids: [...document.querySelectorAll('[data-theme-id]')].map((node) => node.dataset.themeId),
  canvasHeight: document.querySelector('#themeVirtualCanvas').style.height,
}))()`);

await send("Emulation.setDeviceMetricsOverride", {
  width: 800,
  height: 600,
  deviceScaleFactor: 1,
  mobile: false,
});
await sleep(400);
const compactBefore = await evaluate(`(() => ({
  rendered: document.querySelectorAll('[data-theme-id]').length,
  ids: [...document.querySelectorAll('[data-theme-id]')].map((node) => node.dataset.themeId),
}))()`);
await capture("themes-compact.png");
await evaluate(`(() => { const view = document.querySelector('#themeViewport'); view.scrollTop = view.scrollHeight; view.dispatchEvent(new Event('scroll')); })()`);
await sleep(350);
const compactAfter = await evaluate(`(() => ({
  rendered: document.querySelectorAll('[data-theme-id]').length,
  ids: [...document.querySelectorAll('[data-theme-id]')].map((node) => node.dataset.themeId),
}))()`);

await evaluate(`document.querySelector('[data-view="settings"]').click()`);
await sleep(250);
const settingsState = await evaluate(`(() => ({
  visible: !document.querySelector('[data-view-panel="settings"]').hidden,
  mode: document.documentElement.dataset.theme,
  soundOn: JSON.parse(localStorage.getItem('co.settings.v1')).soundOn,
}))()`);
await capture("settings-compact.png");

socket.close();
console.log(JSON.stringify({ wideVirtual, compactBefore, compactAfter, settingsState, runtimeErrors }, null, 2));
