/**
 * Shared Admin/Staff session clock. The API owns both deadlines; this script
 * presents them and reports real user activity, never background polling.
 */
(() => {
  "use strict";

  const session = window.AdminSession;
  if (!session || !/\/(admin|staff)-page\//i.test(window.location.pathname)) return;

  const role = session.role;
  const timingKey = `fmrc_${role}_session_timing`;
  const noticeKey = "fmrc_admin_session_notice";
  const authPage = "../admin-auth/auth.html";
  const activityGapMs = 5000;
  const tokenId = (value) => String(value || "").split("|", 1)[0];
  const activeToken = session.getToken();
  if (!activeToken) {
    window.location.replace(authPage);
    return;
  }

  const apiBase = (() => {
    const configured = window.APP_API_BASE_URL ||
      document.querySelector('meta[name="api-base-url"]')?.content || "";
    if (String(configured).trim()) return String(configured).replace(/\/+$/, "");
    const { protocol, hostname, port, origin } = window.location;
    if (!/^https?:$/.test(protocol || "") || !hostname) return "http://127.0.0.1:8000/api";
    if ((hostname === "localhost" || hostname === "127.0.0.1") && port !== "8000") {
      return `${protocol}//${hostname}:8000/api`;
    }
    return `${origin}/api`;
  })();

  let timing = null;
  let serverOffsetMs = 0;
  let serverAnchorMs = 0;
  let monotonicAnchorMs = 0;
  let serverValidated = false;
  let lastServerTime = 0;
  let stopped = false;
  let warningOpen = false;
  let warning = null;
  let countdown = null;
  let statusText = null;
  let stayButton = null;
  let priorFocus = null;
  let activityInFlight = false;
  let queuedActivity = false;
  let lastActivitySentAt = 0;
  let activityTimer = null;

  const monotonicNow = () =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now() : Date.now();
  const serverNow = () => serverAnchorMs + Math.max(0, monotonicNow() - monotonicAnchorMs);
  const parseTime = (value) => {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : null;
  };

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(timingKey) || "null"); }
    catch { return null; }
  })();
  if (saved?.token_id === tokenId(activeToken)) {
    const warningAt = parseTime(saved.idle_warning_at);
    const idleAt = parseTime(saved.idle_expires_at);
    const absoluteAt = parseTime(saved.absolute_expires_at);
    if (warningAt && idleAt && absoluteAt) {
      timing = { warningAt, idleAt, absoluteAt };
      serverOffsetMs = Number(saved.server_offset_ms) || 0;
      lastServerTime = parseTime(saved.server_time) || 0;
      serverAnchorMs = Date.now() + serverOffsetMs;
      monotonicAnchorMs = monotonicNow();
    }
  }

  function endSession(reason) {
    if (stopped) return;
    stopped = true;
    if (activityTimer) clearTimeout(activityTimer);
    try {
      localStorage.removeItem(timingKey);
      sessionStorage.setItem(noticeKey, reason);
    } catch { /* Browser storage may be unavailable. */ }
    session.clearSession();
    window.location.replace(authPage);
  }

  function explainExpiry(code) {
    return code === "SESSION_IDLE"
      ? "Your session ended after inactivity. Sign in again."
      : code === "SESSION_EXPIRED"
        ? "Your six-hour session has ended. Sign in again."
        : "Your session has ended. Sign in again.";
  }

  function applyTiming(data, persist = true) {
    const warningAt = parseTime(data?.idle_warning_at);
    const idleAt = parseTime(data?.idle_expires_at);
    const absoluteAt = parseTime(data?.absolute_expires_at);
    const responseTime = parseTime(data?.server_time);
    if (!warningAt || !idleAt || !absoluteAt || !responseTime) return false;
    if (responseTime < lastServerTime ||
      (responseTime === lastServerTime && timing && warningAt < timing.warningAt)) return false;
    lastServerTime = responseTime;
    serverOffsetMs = responseTime - Date.now();
    serverAnchorMs = responseTime;
    monotonicAnchorMs = monotonicNow();
    serverValidated = true;
    timing = { warningAt, idleAt, absoluteAt };
    if (persist) {
      try {
        localStorage.setItem(timingKey, JSON.stringify({
          token_id: tokenId(activeToken),
          idle_warning_at: data.idle_warning_at,
          idle_expires_at: data.idle_expires_at,
          absolute_expires_at: data.absolute_expires_at,
          server_time: data.server_time,
          server_offset_ms: serverOffsetMs,
        }));
      } catch { /* The server still enforces both limits. */ }
    }
    checkClock();
    return true;
  }

  async function requestSession(method = "GET", interaction = null) {
    if (stopped || session.getToken() !== activeToken) return null;
    let response;
    try {
      response = await fetch(`${apiBase}/admin/session${method === "POST" ? "/activity" : ""}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${activeToken}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify({ interaction }) } : {}),
        cache: "no-store",
      });
    } catch {
      return null;
    }
    if (stopped || session.getToken() !== activeToken) return null;
    let data = {};
    try { data = await response.json(); } catch { /* Use a generic error below. */ }
    if (response.status === 401 || response.status === 403) {
      endSession(explainExpiry(data.code));
      return null;
    }
    if (!response.ok) return null;
    applyTiming(data);
    return data;
  }

  function buildWarning() {
    if (warning || !document.body) return;
    warning = document.createElement("div");
    warning.className = "admin-session-warning";
    warning.hidden = true;
    warning.innerHTML = `
      <section class="admin-session-warning__dialog" role="alertdialog" aria-modal="true"
        aria-labelledby="adminSessionTitle" aria-describedby="adminSessionDescription">
        <span class="admin-session-warning__icon" aria-hidden="true"><i class="fa-solid fa-clock"></i></span>
        <h2 id="adminSessionTitle">Your session is about to end</h2>
        <p id="adminSessionDescription">You've been inactive for 1 hour. Your session will end in 3 minutes.</p>
        <p class="admin-session-warning__remaining">Time remaining <strong aria-hidden="true">03:00</strong></p>
        <p class="admin-session-warning__status" role="status" aria-live="polite"></p>
        <button type="button" class="admin-session-warning__stay">Stay signed in</button>
      </section>`;
    document.body.appendChild(warning);
    countdown = warning.querySelector(".admin-session-warning__remaining strong");
    statusText = warning.querySelector(".admin-session-warning__status");
    stayButton = warning.querySelector(".admin-session-warning__stay");
    stayButton.addEventListener("click", async () => {
      if (stopped) return;
      stayButton.disabled = true;
      statusText.textContent = "Checking your session…";
      const result = await requestSession("POST", "stay_signed_in");
      if (stopped) return;
      stayButton.disabled = false;
      if (!result) {
        statusText.textContent = "We could not confirm your session. Please try again before the timer ends.";
        return;
      }
      statusText.textContent = "";
      checkClock();
    });
    warning.addEventListener("keydown", (event) => {
      if (event.key === "Escape" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        stayButton.focus();
      }
    });
  }

  function showWarning() {
    buildWarning();
    if (!warning || warningOpen) return;
    warningOpen = true;
    priorFocus = document.activeElement;
    warning.hidden = false;
    document.body.classList.add("admin-session-warning-open");
    stayButton.focus();
  }

  function hideWarning() {
    if (!warningOpen) return;
    warningOpen = false;
    warning.hidden = true;
    document.body.classList.remove("admin-session-warning-open");
    if (priorFocus?.isConnected) priorFocus.focus();
  }

  function checkClock() {
    if (stopped || session.getToken() !== activeToken) return;
    if (!timing) return;
    const now = serverNow();
    if (now >= timing.absoluteAt) {
      // A saved offset is only a quick preview. A changed device clock must
      // never clear a still-valid token before the first server status check.
      if (!serverValidated) return;
      endSession(explainExpiry("SESSION_EXPIRED"));
      return;
    }
    if (now >= timing.idleAt) {
      if (!serverValidated) return;
      endSession(explainExpiry("SESSION_IDLE"));
      return;
    }
    if (now >= timing.warningAt) {
      showWarning();
      if (countdown) {
        const seconds = Math.max(0, Math.ceil((timing.idleAt - now) / 1000));
        countdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      }
    } else {
      hideWarning();
    }
  }

  async function sendActivity() {
    activityTimer = null;
    if (stopped || warningOpen || activityInFlight || session.getToken() !== activeToken) return;
    activityInFlight = true;
    lastActivitySentAt = Date.now();
    await requestSession("POST", "activity");
    activityInFlight = false;
    if (queuedActivity && !stopped && !warningOpen) {
      queuedActivity = false;
      scheduleActivity();
    }
  }

  function scheduleActivity(event) {
    if (event?.isTrusted === false || stopped || warningOpen) return;
    if (activityInFlight) {
      queuedActivity = true;
      return;
    }
    if (activityTimer) return;
    const wait = Math.max(0, activityGapMs - (Date.now() - lastActivitySentAt));
    if (wait === 0) void sendActivity();
    else activityTimer = setTimeout(sendActivity, wait);
  }

  ["pointerdown", "pointermove", "touchstart", "keydown", "scroll"].forEach((type) => {
    document.addEventListener(type, scheduleActivity, { capture: true, passive: type !== "keydown" });
  });
  window.addEventListener("focus", () => { checkClock(); void requestSession(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { checkClock(); void requestSession(); }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === timingKey && event.newValue) {
      try {
        const next = JSON.parse(event.newValue);
        if (next.token_id === tokenId(activeToken)) {
          applyTiming({
            server_time: next.server_time || new Date(Date.now() + (Number(next.server_offset_ms) || 0)).toISOString(),
            idle_warning_at: next.idle_warning_at,
            idle_expires_at: next.idle_expires_at,
            absolute_expires_at: next.absolute_expires_at,
          }, false);
        }
      } catch { /* A later server check will refresh the clock. */ }
    }
    if (event.key === `${role}_auth_token` && event.newValue !== activeToken) {
      if (event.newValue) window.location.reload();
      else endSession("Your session has ended. Sign in again.");
    }
  });

  setInterval(checkClock, 1000);
  checkClock();
  void requestSession();
})();
