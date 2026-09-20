const params = new URLSearchParams(window.location.search);
const port = Number(params.get("port") || "10100");
const status = document.querySelector("#status");
const retry = document.querySelector("#retry");

async function check() {
  status.textContent = `Connecting to OpenCodex proxy at 127.0.0.1:${port}…`;
  retry.disabled = true;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/startup-health`, {
      cache: "no-store",
    });
    if (response.ok) {
      status.textContent = "Proxy is ready. Loading dashboard…";
      return;
    }
    throw new Error(`HTTP ${response.status}`);
  } catch {
    status.textContent = "The proxy is not reachable yet.";
  } finally {
    retry.disabled = false;
  }
}

retry.addEventListener("click", check);
check();
