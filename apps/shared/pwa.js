/* FMRC app identity, navigation and explicit device opt-in. No automatic permission prompts. */
(() => {
  "use strict";
  const app = /\/(?:admin|staff)-page\/|\/admin-auth\/|^\/apps\/team(?:\/|$)/.test(location.pathname) ? "team" : "customer";
  const prefix = `/apps/${app}/`;
  const inApp = location.pathname.startsWith(prefix);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const iphoneVersion = navigator.userAgent.match(/iPhone.*OS (\d+)_(\d+)/);
  const modernIphone = !!iphoneVersion && (+iphoneVersion[1] > 16 || (+iphoneVersion[1] === 16 && +iphoneVersion[2] >= 4));
  const androidPhone = /Android/i.test(navigator.userAgent) && (/Mobile/i.test(navigator.userAgent) || navigator.userAgentData?.mobile === true);
  const installDevice = (modernIphone || androidPhone) && !!navigator.serviceWorker && window.isSecureContext;
  document.documentElement.classList.toggle("fmrc-mobile-install", installDevice);
  const storageKey = `fmrc_pwa_${app}_device`;
  const installedKey = `fmrc_pwa_${app}_installed`;
  const inventoryKey = `${installedKey}_verified`;
  let teamLaunch = false;
  if (app === "team" && inApp && /\/(admin|staff)-(page|auth)\//.test(location.pathname)) {
    try { teamLaunch = sessionStorage.getItem("fmrc_pwa_team_launch") === "1"; sessionStorage.removeItem("fmrc_pwa_team_launch"); } catch {}
    if (teamLaunch) {
      document.documentElement.classList.add("fmrc-app-booting");
      // A missing loader script must never leave the portal hidden.
      setTimeout(() => document.documentElement.classList.remove("fmrc-app-booting"), 5000);
    }
  }
  let knownInstalled = false, verifiedInventory = false, checkingInstallation = false;
  let installationChecked = !installDevice || !navigator.getInstalledRelatedApps || standalone();
  try {
    knownInstalled = localStorage.getItem(installedKey) === "1";
    verifiedInventory = localStorage.getItem(inventoryKey) === "1";
  } catch {}
  const isInstalled = () => standalone() || knownInstalled;
  document.documentElement.classList.toggle("fmrc-app-installed", isInstalled());
  document.documentElement.classList.toggle("fmrc-install-checking", !installationChecked);
  function rememberInstallation(value, inventory = false) {
    knownInstalled = value;
    if (inventory) verifiedInventory = true;
    if (!value) verifiedInventory = false;
    try {
      if (value) localStorage.setItem(installedKey, "1"); else localStorage.removeItem(installedKey);
      if (verifiedInventory) localStorage.setItem(inventoryKey, "1"); else localStorage.removeItem(inventoryKey);
    } catch {}
    document.documentElement.classList.toggle("fmrc-app-installed", isInstalled());
    inject();
    refreshPhoneControls();
  }
  async function checkInstallation() {
    if (!installDevice) return;
    if (standalone()) { rememberInstallation(true); return; }
    if (checkingInstallation) return;
    if (!navigator.getInstalledRelatedApps || localAppOrigin()) {
      installationChecked = true; document.documentElement.classList.remove("fmrc-install-checking"); inject(); return;
    }
    checkingInstallation = true;
    try {
      const related = await Promise.race([
        navigator.getInstalledRelatedApps(),
        new Promise(resolve => setTimeout(() => resolve(null), 3000)),
      ]);
      if (!Array.isArray(related)) return;
      const found = related.some(entry => {
        if (entry.platform !== "webapp") return false;
        try {
          const manifest = entry.url && new URL(entry.url, location.href);
          const identity = entry.id && new URL(entry.id, location.origin);
          return (manifest?.origin === location.origin && manifest.pathname === `${prefix}manifest.webmanifest`)
            || (identity?.origin === location.origin && identity.pathname === prefix);
        } catch { return false; }
      });
      if (found) rememberInstallation(true, true);
      // Only an inventory that previously recognized this exact app can report
      // removal. Empty results from shortcut/unsupported browsers are inconclusive.
      else if (verifiedInventory) rememberInstallation(false);
    } catch {} finally {
      checkingInstallation = false; installationChecked = true;
      document.documentElement.classList.remove("fmrc-install-checking"); inject();
    }
  }
  const parse = (value, fallback = null) => { try { return JSON.parse(value) || fallback; } catch { return fallback; } };
  const saved = () => parse(localStorage.getItem(storageKey));
  const save = value => { if (value) localStorage.setItem(storageKey, JSON.stringify(value)); else localStorage.removeItem(storageKey); };
  const role = () => location.pathname.includes("/staff-page/") ? "staff" : location.pathname.includes("/admin-page/") ? "admin" : localStorage.getItem("fmrc_pwa_team_role") || "admin";
  const token = () => localStorage.getItem(app === "customer" ? "customer_token" : `${role()}_auth_token`) || "";
  const apiBase = () => String(window.APP_API_BASE_URL || document.querySelector('meta[name="api-base-url"]')?.content ||
    ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.port !== "8000" ? `${location.protocol}//${location.hostname}:8000/api` : `${location.origin}/api`)).replace(/\/+$/, "");
  const localAppOrigin = () => {
    if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return null;
    const origin = new URL(apiBase(), location.href).origin;
    return origin !== location.origin ? origin : null;
  };
  const url = (raw, force = false) => {
    try {
      const u = new URL(raw, location.href);
      if (u.origin !== location.origin || (!inApp && !force)) return u.href;
      if (u.pathname.startsWith(prefix)) return u.href;
      const roots = app === "customer" ? ["home-page", "about-page", "services-page", "products-page", "contact-page", "customer-auth"] : ["admin-page", "staff-page", "admin-auth"];
      if (roots.some(root => u.pathname.startsWith(`/${root}/`)) && !/\.(?:js|css|png|svg|jpe?g|webp|woff2?|mp4|pdf)$/i.test(u.pathname)) u.pathname = prefix.slice(0, -1) + u.pathname;
      return u.href;
    } catch { return raw; }
  };
  async function request(path, { method = "GET", body, authenticated = false, device = true } = {}) {
    const headers = { Accept: "application/json" };
    if (body) headers["Content-Type"] = "application/json";
    if (authenticated && token()) headers.Authorization = `Bearer ${token()}`;
    if (device && saved()?.credential) headers["X-FMRC-Device"] = saved().credential;
    const response = await fetch(apiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = Error(response.status === 401 ? "Please sign in again to continue." : response.status === 409 ? "Reset notifications on this device, then enable them again." : "Notifications are unavailable right now. Please try again."); error.status = response.status; throw error; }
    return data;
  }
  let registration, installPrompt, configuration, configuredAt = 0, lastSyncedToken = null;
  const config = async (refresh = false) => {
    if (refresh || !configuration || Date.now() - configuredAt > 30000) {
      configuration = await request("/pwa/config", { device: false }); configuredAt = Date.now();
    }
    return configuration;
  };
  const registerWorker = async () => {
    if (!navigator.serviceWorker || !window.isSecureContext) return null;
    registration ||= await navigator.serviceWorker.register(`${prefix}sw.js`, { scope: prefix, updateViaCache: "none" });
    await Promise.race([registration.update().catch(() => {}), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (!registration.active) await new Promise(resolve => {
      const worker = registration.installing || registration.waiting;
      if (!worker) return resolve();
      worker.addEventListener("statechange", () => { if (worker.state === "activated") resolve(); });
      setTimeout(resolve, 3000);
    });
    return registration;
  };
  async function workerBinding(value = saved()) {
    const reg = registration || await registerWorker();
    if (!reg?.active) return;
    await new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      reg.active.postMessage({ type: "binding", value: value ? { user_id: value.user_id, public_alerts: !!value.public_alerts, account_alerts: !!value.account_alerts } : null }, [channel.port2]);
      setTimeout(resolve, 1500);
    });
  }
  function status(node, message) { node.textContent = message; }
  function dialog(title, intro) {
    const d = document.createElement("dialog"); d.className = "fmrc-app-dialog";
    const heading = document.createElement("h2"); heading.textContent = title; heading.id = "fmrcAppDialogTitle";
    const close = document.createElement("button"); close.type = "button"; close.className = "fmrc-app-close"; close.textContent = "\u00d7"; close.setAttribute("aria-label", "Close"); close.onclick = () => d.close();
    const copy = document.createElement("p"); copy.textContent = intro;
    d.setAttribute("aria-labelledby", heading.id); d.append(close, heading, copy); document.body.append(d);
    d.addEventListener("close", () => d.remove()); d.addEventListener("click", e => { if (e.target === d) { const rect = d.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) d.close(); } });
    d.showModal(); return d;
  }
  function button(text, handler, secondary = false) { const b = document.createElement("button"); b.type = "button"; b.className = "fmrc-app-button" + (secondary ? " is-secondary" : ""); b.textContent = text; b.addEventListener("click", handler); return b; }
  async function install() {
    if (!installDevice || isInstalled()) return;
    // Live Server cannot run Apache aliases; its install action opens Laravel's app gateway.
    if (localAppOrigin()) { location.href = `${localAppOrigin()}${prefix}install.html`; return; }
    if (installPrompt && !ios) {
      try {
        await installPrompt.prompt(); const choice = await installPrompt.userChoice; installPrompt = null;
        if (choice.outcome === "accepted") rememberInstallation(true);
        return;
      }
      catch { installPrompt = null; }
    }
    const d = dialog(`Install ${app === "customer" ? "FMRC Customer" : "FMRC Admin/Staff"}`, "Keep FMRC on your Home Screen and open it in its own app window.");
    const icon = document.createElement("img"); icon.src = `${prefix}icons/icon-192.png`; icon.className = "fmrc-app-guide-icon"; icon.alt = ""; d.insertBefore(icon, d.firstChild);
    const steps = document.createElement("ol");
    const texts = ios ? ["Open this app in Safari.", "Tap Share, then Add to Home Screen.", "Keep Open as Web App enabled if shown, then tap Add."] : ["Open this app in Chrome, Edge, or another browser with app installation support.", "Open the browser menu and choose Install app or Add to Home screen.", "Confirm to add the FMRC icon to your device."];
    texts.forEach(text => { const li = document.createElement("li"); li.textContent = text; steps.append(li); }); d.append(steps);
    if (!inApp) { const a = document.createElement("a"); a.className = "fmrc-app-button"; a.href = `${prefix}install.html`; a.textContent = "Continue to installation"; d.append(a); }
    // Home Screen shortcuts are not exposed by every browser's app inventory.
    const confirmation = document.createElement("p"); confirmation.textContent = "If FMRC is already on your Home Screen, confirm below to hide Install App in this browser."; d.append(confirmation);
    d.append(button("Already installed", () => { rememberInstallation(true); d.close(); }, true));
  }
  function capabilityMessage() {
    if (!installDevice) return "Phone notifications are available in FMRC on supported iPhones and Android phones.";
    if (localAppOrigin()) return "Open the FMRC app to enable phone notifications on this device.";
    if (!window.isSecureContext) return "Open FMRC using a secure connection to enable phone notifications.";
    if (ios && !standalone()) return isInstalled() ? "Open FMRC from its Home Screen icon to enable phone notifications." : "Install this app on your Home Screen, then open it to enable phone notifications. iPhone requires iOS 16.4 or later.";
    if (!("Notification" in window) || !("PushManager" in window) || !navigator.serviceWorker) return "This browser does not support phone notifications. You can still view updates on the website.";
    if (Notification.permission === "denied") return "Notifications are blocked. Allow them in your device or browser settings, then return here.";
    return "";
  }
  const base64Key = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  async function enable(publicAlerts, accountAlerts) {
    const reason = capabilityMessage(); if (reason) throw Error(reason);
    // Called directly by a button handler: permission is never requested by page load or polling.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw Error("Notifications were not enabled. Allow them in your browser settings to try again.");
    const cfg = await config(); if (!cfg.push_available) throw Error("Phone notifications are not available yet. Please try again later.");
    const reg = await registerWorker(); if (!reg) throw Error("This browser cannot enable phone notifications.");
    let sub = await reg.pushManager.getSubscription();
    if (sub && !saved()) { await sub.unsubscribe(); sub = null; }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Key(cfg.public_key) });
    const data = await request("/pwa/subscriptions", { method: "POST", authenticated: true, body: { app, subscription: sub.toJSON(), public_alerts: publicAlerts, account_alerts: accountAlerts } });
    save({ ...data, credential: data.credential || saved()?.credential, token_id: token().split("|", 1)[0] }); await workerBinding(); lastSyncedToken = token();
  }
  async function disable() {
    await workerBinding(null);
    const current = saved();
    let failure;
    if (current) { try { await request(`/pwa/subscriptions/${current.id}`, { method: "DELETE" }); } catch (e) { if (e.status !== 404) failure = e; } }
    const reg = registration || await registerWorker(); const sub = await reg?.pushManager.getSubscription();
    const unsubscribed = sub ? await sub.unsubscribe() : true;
    save(null);
    if (failure && !unsubscribed) throw failure;
  }
  async function logout() {
    // Clear the worker's private binding before any website credentials are removed.
    const current = saved();
    if (!current) return;
    await workerBinding(app === "customer" ? { ...current, user_id: null, account_alerts: false } : null);
    try {
      const data = await request(`/pwa/subscriptions/${current.id}`, { method: "PATCH", body: { detach: true } });
      if (app === "team") { await (await registration?.pushManager.getSubscription())?.unsubscribe(); save(null); }
      else save({ ...current, ...data });
    } catch {
      // Offline logout must still stop delivery. Re-enable public alerts on the next visit.
      await disable().catch(() => {});
    }
    lastSyncedToken = null;
  }
  async function syncAccount() {
    const current = saved(), activeToken = token();
    if (!current || !activeToken || activeToken === lastSyncedToken) return;
    lastSyncedToken = activeToken;
    if (current.token_id === activeToken.split("|", 1)[0]) return;
    // Suspend old private alerts locally while checking/binding the current authenticated account.
    await workerBinding({ ...current, account_alerts: false });
    try {
      if (app === "customer") await request(`/pwa/subscriptions/${current.id}`, { method: "PATCH", body: { detach: true } });
      const data = await request(`/pwa/subscriptions/${current.id}`, { method: "PATCH", authenticated: true,
        body: { bind: true, account_alerts: !!current.account_alerts } });
      save({ ...current, ...data, token_id: activeToken.split("|", 1)[0] }); await workerBinding();
    } catch (e) {
      if (e.status === 404) { await disable().catch(() => {}); }
      // Session expiry does not revoke an existing device grant. Account switches cannot inherit it.
      else if (e.status === 401 || e.status === 403) await logout();
    }
  }
  const phonePanels = new Map();
  function refreshPhoneControls(refresh = false) {
    for (const [panel, update] of phonePanels) {
      if (!panel.isConnected) phonePanels.delete(panel);
      else void update(refresh);
    }
  }
  function controls(container, embedded = false) {
    if (!installDevice || container.querySelector(".fmrc-phone-controls")) return;
    const panel = document.createElement("section"); panel.className = "fmrc-phone-controls";
    const title = document.createElement("h3"); title.textContent = "Phone notifications";
    const intro = document.createElement("p"); intro.textContent = app === "customer" ? "Choose which FMRC updates reach this device. Phone previews keep account details private." : "Receive private FMRC update previews on this device, including after your website session expires. Signing out turns them off.";
    const message = document.createElement("p"); message.className = "fmrc-app-status"; message.setAttribute("role", "status");
    status(message, saved() ? "Notifications enabled for this device." : "Phone notifications are off.");
    if (app === "team" && !container.querySelector(".fmrc-settings-install")) {
      const installAction = button("Install App", install, true); installAction.classList.add("fmrc-settings-install"); installAction.hidden = isInstalled() || !installationChecked; container.append(installAction);
    }
    const fields = [];
    for (const [key, label] of app === "customer" ? [["public_alerts", "Announcements & promotions"], ["account_alerts", "My orders & appointments"]] : [["account_alerts", "Workspace updates"]]) {
      const row = document.createElement("label"); row.className = "fmrc-app-check"; const input = document.createElement("input"); input.type = "checkbox"; input.dataset.preference = key;
      input.checked = saved() ? !!saved()[key] : key === "public_alerts" || !!token(); input.disabled = key === "account_alerts" && !token() && !saved()?.user_id;
      row.append(input, document.createTextNode(label)); panel.append(row); fields.push(input);
    }
    if (app === "customer" && !token() && !saved()?.user_id) {
      const note = document.createElement("p"); note.className = "fmrc-account-alert-hint";
      const signIn = document.createElement("a"); signIn.href = loginDestination("../customer-auth/auth.html#login"); signIn.textContent = "Sign in";
      note.append(signIn, document.createTextNode(" to enable your order and appointment alerts.")); panel.append(note);
    }
    const actions = document.createElement("div"); actions.className = "fmrc-app-actions fmrc-phone-actions";
    let busy = false;
    const apply = button(saved() ? "Save preferences" : "Enable notifications", async () => {
      busy = true;
      apply.disabled = true; status(message, "Updating notifications…");
      try {
        const prefs = Object.fromEntries(fields.map(field => [field.dataset.preference, field.checked]));
        if (!prefs.public_alerts && !prefs.account_alerts) { await disable(); }
        else if (saved()) {
          const data = await request(`/pwa/subscriptions/${saved().id}`, { method: "PATCH", authenticated: !!token(), body: { ...prefs, ...(token() ? { bind: true } : {}) } });
          save({ ...saved(), ...data, token_id: token() ? token().split("|", 1)[0] : saved()?.token_id }); await workerBinding();
        } else await enable(!!prefs.public_alerts, !!prefs.account_alerts);
        status(message, saved() ? "Notifications enabled for this device." : "Phone notifications are off.");
        apply.textContent = saved() ? "Save preferences" : "Enable notifications"; off.hidden = !saved();
      } catch (error) {
        if (error.status === 404 && saved()) {
          await disable().catch(() => {}); off.hidden = true; apply.textContent = "Enable notifications";
          status(message, "This device's subscription has ended. Enable notifications again to reconnect it.");
        } else status(message, error.message);
      } finally { busy = false; await updateAvailability(); }
    });
    const off = button("Turn off", async () => { busy = true; off.disabled = true; try { await disable(); status(message, "Phone notifications are off."); off.hidden = true; apply.textContent = "Enable notifications"; } catch (e) { status(message, e.message); } finally { busy = false; off.disabled = false; await updateAvailability(); } }, true);
    off.hidden = !saved(); actions.append(apply, off); if (!embedded) panel.prepend(title, intro); panel.append(actions, message); container.append(panel);
    let unavailable = false;
    apply.disabled = true;
    async function updateAvailability(refresh = false) {
      if (busy) return;
      const reason = capabilityMessage();
      if (reason) { unavailable = true; apply.disabled = true; status(message, reason); return; }
      try {
        const cfg = await config(refresh); if (busy || !panel.isConnected) return;
        apply.disabled = !cfg.push_available && !saved();
        if (!cfg.push_available) { unavailable = true; status(message, "Phone notifications are not available yet. Please try again later."); }
        else if (unavailable) { unavailable = false; status(message, saved() ? "Notifications enabled for this device." : "Enable notifications to receive FMRC updates on this phone."); }
      } catch {
        if (!busy) { unavailable = true; apply.disabled = !saved(); status(message, "Connect to FMRC to check phone notification availability."); }
      }
    }
    phonePanels.set(panel, updateAvailability); void updateAvailability();
  }
  const bellSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
  let bell, preferences;
  const guestReadsKey = "fmrc_customer_public_reads";
  const guestReads = () => parse(localStorage.getItem(guestReadsKey), []);
  const guestReadThrough = () => Number(localStorage.getItem("fmrc_customer_public_read_through")) || 0;
  async function badge(count) {
    if (standalone()) try { if (count) await navigator.setAppBadge?.(count); else await navigator.clearAppBadge?.(); } catch {}
  }
  async function refreshBadge() {
    if (app !== "customer" || !standalone()) return;
    try {
      const cfg = await config(); if (!cfg.inbox_available) return;
      const data = await request(token() ? "/customer/notifications/unread-count"
        : `/customer/notifications/unread-count?after=${guestReadThrough()}&read_ids=${guestReads().join(",")}`, { authenticated: !!token() });
      await badge(data.unread_count);
    } catch {}
  }
  async function markRead(row) {
    if (token()) await request(`/customer/notifications/${row.id}/read`, { method: "PATCH", authenticated: true });
    else localStorage.setItem(guestReadsKey, JSON.stringify([...new Set([...guestReads(), row.id])].slice(-200)));
    await refreshBadge();
  }
  function openPreferences() {
    if (!installDevice || preferences?.open) return;
    preferences = dialog("Phone notifications", "Choose which FMRC updates reach this device. Phone previews keep account details private.");
    preferences.classList.add("fmrc-permissions-dialog");
    controls(preferences, true);
  }
  async function consumeCustomerNotification() {
    if (app !== "customer" || /\/customer-auth\//.test(location.pathname)) return;
    const id = incoming || sessionStorage.getItem(pendingKey);
    if (!id || !/^\d+$/.test(id)) return;
    try {
      // Resolve only the selected, visible record. Preferences never render an inbox.
      const record = await request(`/customer/notifications/${id}`, { authenticated: !!token(), device: false });
      const destination = new URL(url(record.target), location.href);
      const originalPath = destination.pathname.startsWith(prefix) ? destination.pathname.slice(prefix.length - 1) : destination.pathname;
      if (destination.origin !== location.origin || !/^\/(home-page|about-page|services-page|products-page|contact-page)\//.test(originalPath)) throw Error("This update is unavailable.");
      await markRead(record).catch(() => {});
      sessionStorage.removeItem(pendingKey);
      location.replace(destination.href);
    } catch (error) {
      if (!token() && (error.status === 404 || error.status === 401)) {
        location.replace(loginDestination("../customer-auth/auth.html#login")); return;
      }
      const d = dialog("Notification unavailable", "Open your orders, appointments or announcements to check the latest update.");
      d.append(button("Close", () => { sessionStorage.removeItem(pendingKey); d.close(); }, true));
    }
  }
  function inject() {
    document.querySelectorAll(".fmrc-install-button,.fmrc-settings-install,[data-fmrc-install]").forEach(action => { action.hidden = !installDevice || isInstalled() || !installationChecked; });
    const installationHint = document.querySelector("[data-fmrc-install-hint]");
    if (installationHint) {
      const hint = !installDevice ? "Open FMRC on an iPhone with iOS 16.4 or later, or a supported Android phone, to install the app."
        : isInstalled() ? "FMRC is installed. Open it from its Home Screen icon."
        : "Install FMRC for a dedicated Home Screen icon and app window.";
      if (installationHint.textContent !== hint) installationHint.textContent = hint;
      if (installDevice && !installationHint.parentElement.querySelector(".fmrc-install-confirm")) {
        const confirmed = button("I've already installed this app", () => rememberInstallation(true), true);
        confirmed.classList.add("fmrc-install-confirm");
        const removed = button("I removed this app", () => rememberInstallation(false), true);
        removed.classList.add("fmrc-install-reset"); installationHint.parentElement.append(confirmed, removed);
      }
      const confirmed = installationHint.parentElement.querySelector(".fmrc-install-confirm"), removed = installationHint.parentElement.querySelector(".fmrc-install-reset");
      if (confirmed) confirmed.hidden = !installDevice || isInstalled();
      if (removed) removed.hidden = !installDevice || !knownInstalled || standalone();
    }
    // Operator installation belongs only in Settings, including app windows.
    if (app === "team") document.querySelectorAll(".sidebar-footer .fmrc-install-button").forEach(action => action.remove());
    // The navbar announcement bell belongs to customer-announcements.js.
    // App notifications have their own phone-sidebar entry and never replace it.
    if (app === "customer" && installDevice) {
      const footer = document.querySelector(".mobile-sidebar .sidebar-footer-actions");
      if (footer) {
        const sidebar = footer.parentElement;
        let appActions = sidebar.querySelector(".fmrc-sidebar-app-actions");
        if (!appActions) {
          appActions = document.createElement("div"); appActions.className = "fmrc-sidebar-app-actions";
          appActions.setAttribute("role", "group"); appActions.setAttribute("aria-label", "FMRC app");
          sidebar.insertBefore(appActions, footer); sidebar.classList.add("fmrc-sidebar-apps");
        }
        if (!isInstalled() && !appActions.querySelector(".fmrc-install-button")) {
          const action = button("Install App", install, true); action.classList.add("fmrc-install-button");
          action.hidden = !installationChecked; appActions.prepend(action);
        }
        if (!bell?.isConnected) {
          bell = button("App Notifications", () => {
            document.querySelector(".mobile-sidebar .sidebar-close-btn")?.click();
            openPreferences();
          }, true);
          bell.classList.add("fmrc-app-inbox-button");
          bell.innerHTML = `${bellSvg}<span class="nav-label">App Notifications</span>`;
          bell.setAttribute("aria-label", "App notification permissions"); appActions.append(bell);
        }
      }
    }
    if (app === "team" && installDevice && /\/settings(?:\.html)?\/?$/.test(location.pathname)) {
      const container = document.querySelector(".portal-settings, .settings-content, .settings-card, .settings-panel") || document.querySelector("main");
      if (container) controls(container);
    }
    if (inApp) document.querySelectorAll("a[href],form[action]").forEach(element => {
      const key = element.tagName === "FORM" ? "action" : "href", raw = element.getAttribute(key);
      if (!raw || raw.startsWith("#")) return;
      const mapped = url(raw); if (mapped !== element[key]) element.setAttribute(key, mapped);
    });
  }
  async function launch() {
    const query = location.search + location.hash;
    if (localAppOrigin()) return location.replace(`${localAppOrigin()}${prefix}${query}`);
    if (app === "customer") return location.replace(`${prefix}home-page/main.html${query}`);
    try { sessionStorage.setItem("fmrc_pwa_team_launch", "1"); } catch {}
    // The destination already enforces the authenticated session. No extra
    // launcher screen or duplicate session request is needed before its loader.
    location.replace(`${prefix}${token() ? `${role()}-page/dashboard.html` : "admin-auth/auth.html"}${query}`);
  }
  const pendingKey = `fmrc_pwa_${app}_notification`;
  const incoming = new URLSearchParams(location.search).get("notification");
  if (incoming && /^\d+$/.test(incoming)) sessionStorage.setItem(pendingKey, incoming);
  function loginDestination(fallback) {
    const target = new URL(url(fallback), location.href), pending = sessionStorage.getItem(pendingKey);
    if (pending) target.searchParams.set("notification", pending);
    return target.href;
  }
  let teamNotificationOpened = false;
  function consumeTeamNotification(notifications, openNotification) {
    if (app !== "team" || teamNotificationOpened) return;
    const id = incoming || sessionStorage.getItem(pendingKey); if (!id) return;
    teamNotificationOpened = true; sessionStorage.removeItem(pendingKey);
    const record = notifications.find(n => String(n.id) === String(id));
    if (!record) return dialog("Notification unavailable", "This update has been removed or is no longer available to your account. Your recent notifications are available from the bell.");
    void openNotification(id);
  }
  window.FMRCApp = { app, prefix, inApp, installDevice, url, install, enable, disable, logout, syncAccount, openPreferences, controls, launch, loginDestination, consumeTeamNotification, updateBadge: badge };
  if (installDevice && !localAppOrigin()) { const manifest = document.createElement("link"); manifest.rel = "manifest"; manifest.href = `${prefix}manifest.webmanifest`; document.head.append(manifest); }
  function applyAppIdentity() {
    // The shared script loads before the original head links are parsed. Wait
    // for boot so Safari cannot select a second, older Apple icon link.
    const touches = Array.from(document.querySelectorAll('link[rel="apple-touch-icon"]'));
    const touch = touches.shift() || document.createElement("link"); touch.rel = "apple-touch-icon";
    touch.href = `${prefix}icons/apple-touch-icon.png${app === "team" ? "?v=3" : ""}`;
    if (!touch.isConnected) document.head.append(touch); touches.forEach(extra => extra.remove());
    const themes = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    const theme = themes.shift() || document.createElement("meta"); theme.name = "theme-color";
    theme.content = app === "customer" ? "#fff9ed" : "#701b2b";
    if (!theme.isConnected) document.head.append(theme); themes.forEach(extra => extra.remove());
  }
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    if (installDevice && !standalone()) { installPrompt = event; void checkInstallation(); }
  });
  window.addEventListener("appinstalled", () => { if (installDevice) { installPrompt = null; rememberInstallation(true); } });
  matchMedia("(display-mode: standalone)").addEventListener?.("change", () => { if (standalone()) rememberInstallation(true); else inject(); });
  window.addEventListener("storage", event => {
    if (event.key === installedKey || event.key === null) {
      try { knownInstalled = localStorage.getItem(installedKey) === "1"; } catch {}
      document.documentElement.classList.toggle("fmrc-app-installed", isInstalled()); inject();
    }
    if (event.key === storageKey) void workerBinding();
    if (/token$|user_info$|customer_user/.test(event.key || "")) { void syncAccount(); void refreshBadge(); }
  });
  window.addEventListener("admin:session-updated", syncAccount);
  window.addEventListener("pageshow", () => { void checkInstallation(); });
  window.addEventListener("focus", () => { void checkInstallation(); });
  window.addEventListener("online", () => { configuration = null; refreshPhoneControls(); void refreshBadge(); void syncAccount(); void checkInstallation(); });
  document.addEventListener("click", event => {
    if (!inApp) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor && !anchor.getAttribute("href").startsWith("#")) anchor.href = url(anchor.href);
  }, true);
  document.addEventListener("submit", event => { if (inApp && event.target instanceof HTMLFormElement) event.target.action = url(event.target.action); }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refreshPhoneControls(true); void checkInstallation(); void refreshBadge(); void syncAccount(); } });
  const boot = async () => {
    if (teamLaunch && window.FMRCLoader && !document.querySelector(".fmrc-load-boot")) {
      window.FMRCLoader.show("Preparing your experience", "", { fullscreen: true });
      const curtain = document.querySelector(".fmrc-load-veil");
      curtain?.classList.add("fmrc-app-entry-loader");
      if (curtain) {
        const cleanup = new MutationObserver(() => {
          if (curtain.classList.contains("is-on")) return;
          cleanup.disconnect();
          setTimeout(() => curtain.classList.remove("fmrc-app-entry-loader"), 220);
        });
        cleanup.observe(curtain, { attributes: true, attributeFilter: ["class"] });
      }
      requestAnimationFrame(() => window.FMRCLoader.hide());
    }
    document.documentElement.classList.remove("fmrc-app-booting");
    applyAppIdentity();
    if (app === "team" && /\/(admin|staff)-page\//.test(location.pathname) && token()) localStorage.setItem("fmrc_pwa_team_role", role());
    if (installDevice && standalone()) rememberInstallation(true);
    inject(); void checkInstallation(); const observer = new MutationObserver(inject); observer.observe(document.body, { childList: true, subtree: true });
    await registerWorker().catch(() => null); if (saved()) { await workerBinding(); await syncAccount(); }
    if (app === "customer") await consumeCustomerNotification();
    setInterval(() => { if (!document.hidden) { refreshPhoneControls(); void refreshBadge(); void syncAccount(); void checkInstallation(); } }, 60000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else void boot();
})();
