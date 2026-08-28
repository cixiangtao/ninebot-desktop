const reasonLabels = {
  "renderer-crashed": "渲染进程崩溃",
  "renderer-killed": "渲染进程被终止",
  "renderer-oom": "渲染进程内存不足",
  "renderer-launch-failed": "渲染进程启动失败",
  "renderer-integrity-failure": "渲染进程完整性检查失败",
};

const reason = new URLSearchParams(window.location.search).get("reason") ?? "unknown";
const reasonElement = document.querySelector("#reason");
if (reasonElement) {
  reasonElement.textContent = reasonLabels[reason] ?? `本地加载异常 · ${reason}`;
}

document.querySelector("#reload")?.addEventListener("click", () => {
  window.location.replace("qiji://app/index.html");
});
