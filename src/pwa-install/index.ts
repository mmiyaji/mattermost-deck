interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
}

const PROMPT_TIMEOUT_MS = 6000;
let deferredPrompt: BeforeInstallPromptEvent | null = null;

const timeoutId = window.setTimeout(() => {
  if (deferredPrompt !== null) return;
  showFallback();
}, PROMPT_TIMEOUT_MS);

window.addEventListener("beforeinstallprompt", (e) => {
  clearTimeout(timeoutId);
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
  showOverlay();
});

function showFallback(): void {
  if (document.getElementById("mmd-install-fallback")) return;

  const banner = document.createElement("div");
  banner.id = "mmd-install-fallback";
  banner.style.cssText = [
    "position:fixed", "bottom:24px", "left:50%", "transform:translateX(-50%)",
    "z-index:2147483647", "background:#1e293b", "color:#e2e8f0",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
    "font-size:14px", "padding:14px 20px", "border-radius:10px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.5)", "max-width:420px", "width:calc(100% - 48px)",
    "display:flex", "align-items:center", "gap:12px",
    "border:1px solid rgba(255,255,255,0.12)",
  ].join(";");

  banner.innerHTML = `
    <span style="font-size:20px;flex:none">ℹ️</span>
    <span style="flex:1;line-height:1.5">
      アドレスバーの <strong>インストール</strong> アイコン（<strong>⊕</strong>）からMattermostをインストールしてください。
    </span>
    <button id="mmd-fallback-close" style="
      background:none;border:none;color:#94a3b8;cursor:pointer;
      font-size:18px;padding:0;flex:none;line-height:1
    ">✕</button>
  `;

  document.body.appendChild(banner);
  document.getElementById("mmd-fallback-close")!.addEventListener("click", () => banner.remove());
}

function showOverlay(): void {
  if (document.getElementById("mmd-install-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "mmd-install-overlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483647",
    "background:rgba(0,0,0,0.72)",
    "display:flex", "align-items:center", "justify-content:center",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
  ].join(";");

  overlay.innerHTML = `
    <div style="background:#1e1e2e;border-radius:14px;padding:36px 40px;text-align:center;color:#e2e8f0;max-width:380px;box-shadow:0 24px 64px rgba(0,0,0,0.6)">
      <div style="font-size:48px;margin-bottom:16px">📲</div>
      <h2 style="margin:0 0 10px;font-size:20px;font-weight:700">Mattermostをインストール</h2>
      <p style="margin:0 0 28px;font-size:14px;opacity:0.65;line-height:1.6">
        アプリとしてインストールすると<br>タスクバーから直接起動できます
      </p>
      <button id="mmd-install-btn" style="
        background:#1c58d9;color:#fff;border:none;border-radius:8px;
        padding:12px 32px;font-size:15px;font-weight:600;cursor:pointer;
        margin-right:10px;transition:opacity 0.15s
      ">インストール</button>
      <button id="mmd-cancel-btn" style="
        background:rgba(255,255,255,0.1);color:#e2e8f0;border:none;border-radius:8px;
        padding:12px 20px;font-size:15px;cursor:pointer
      ">キャンセル</button>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("mmd-install-btn")!.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    overlay.remove();
    const result = await deferredPrompt.prompt();
    deferredPrompt = null;
    if (result.outcome === "accepted") {
      await chrome.storage.local.set({ "mattermostDeck.pwaInstalled.v1": true });
      window.close();
    }
  });

  document.getElementById("mmd-cancel-btn")!.addEventListener("click", () => {
    overlay.remove();
  });
}
