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
  let registration, installPrompt, configuration, lastSyncedToken = null;
  const config = async () => configuration ||= await request("/pwa/config", { device: false });
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
    if (!installDevice || standalone()) return;
    // Live Server cannot run Apache aliases; its install action opens Laravel's app gateway.
    if (localAppOrigin()) { location.href = `${localAppOrigin()}${prefix}install.html`; return; }
    if (installPrompt && !ios) {
      try { await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; return; }
      catch { installPrompt = null; }
    }
    const d = dialog(`Install ${app === "customer" ? "FMRC Customer" : "FMRC Admin/Staff"}`, "Keep FMRC on your Home Screen and open it in its own app window.");
    const icon = document.createElement("img"); icon.src = `${prefix}icons/icon-192.png`; icon.className = "fmrc-app-guide-icon"; icon.alt = ""; d.insertBefore(icon, d.firstChild);
    const steps = document.createElement("ol");
    const texts = ios ? ["Open this app in Safari.", "Tap Share, then Add to Home Screen.", "Keep Open as Web App enabled if shown, then tap Add."] : ["Open this app in Chrome, Edge, or another browser with app installation support.", "Open the browser menu and choose Install app or Add to Home screen.", "Confirm to add the FMRC icon to your device."];
    texts.forEach(text => { const li = document.createElement("li"); li.textContent = text; steps.append(li); }); d.append(steps);
    if (!inApp) { const a = document.createElement("a"); a.className = "fmrc-app-button"; a.href = `${prefix}install.html`; a.textContent = "Continue to installation"; d.append(a); }
    else d.append(button("Done", () => d.close()));
  }
  function capabilityMessage() {
    if (!installDevice) return "Phone notifications are available in FMRC on supported iPhones and Android phones.";
    if (localAppOrigin()) return "Open the FMRC app to enable phone notifications on this device.";
    if (!window.isSecureContext) return "Open FMRC using a secure connection to enable phone notifications.";
    if (ios && !standalone()) return "Install this app on your Home Screen, then open it to enable phone notifications. iPhone requires iOS 16.4 or later.";
    if (!("Notification" in window) || !("PushManager" in window) || !navigator.serviceWorker) return "This browser does not support phone notifications. Your FMRC inbox is still available.";
    if (Notification.permission === "denied") return "Notifications are blocked. Allow them in your device or browser settings, then return here.";
    return "";
  }
  const base64Key = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
  async function enable(publicAlerts, accountAlerts) {
    const reason = capabilityMessage(); if (reason) throw Error(reason);
    // Called directly by a button handler: permission is never requested by page load or polling.
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw Error("Notifications were not enabled. You can continue using the FMRC inbox.");
    const cfg = await config(); if (!cfg.push_available) throw Error("Phone notifications are not available yet. Your FMRC inbox is ready to use.");
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
  function controls(container) {
    if (!installDevice || container.querySelector(".fmrc-phone-controls")) return;
    const panel = document.createElement("section"); panel.className = "fmrc-phone-controls";
    const title = document.createElement("h3"); title.textContent = "Phone notifications";
    const intro = document.createElement("p"); intro.textContent = app === "customer" ? "Choose which FMRC updates reach this device. Phone previews keep account details private." : "Receive private FMRC update previews on this device, including after your website session expires. Signing out turns them off.";
    const message = document.createElement("p"); message.className = "fmrc-app-status"; message.setAttribute("role", "status");
    if (app === "team" && installDevice && !standalone()) {
      const installAction = button("Install App", install, true); installAction.classList.add("fmrc-settings-install"); panel.append(installAction);
    }
    const fields = [];
    for (const [key, label] of app === "customer" ? [["public_alerts", "Announcements & promotions"], ["account_alerts", "My orders & appointments"]] : [["account_alerts", "Workspace updates"]]) {
      const row = document.createElement("label"); row.className = "fmrc-app-check"; const input = document.createElement("input"); input.type = "checkbox"; input.dataset.preference = key;
      input.checked = saved() ? !!saved()[key] : key === "public_alerts" || !!token(); input.disabled = key === "account_alerts" && !token() && !saved()?.user_id;
      row.append(input, document.createTextNode(label)); panel.append(row); fields.push(input);
    }
    const actions = document.createElement("div"); actions.className = "fmrc-app-actions";
    const apply = button(saved() ? "Update Preferences" : "Enable Notifications", async () => {
      apply.disabled = true; status(message, "Updating notifications…");
      try {
        const prefs = Object.fromEntries(fields.map(field => [field.dataset.preference, field.checked]));
        if (!prefs.public_alerts && !prefs.account_alerts) { await disable(); }
        else if (saved()) {
          const data = await request(`/pwa/subscriptions/${saved().id}`, { method: "PATCH", authenticated: !!token(), body: { ...prefs, ...(token() ? { bind: true } : {}) } });
          save({ ...saved(), ...data, token_id: token() ? token().split("|", 1)[0] : saved()?.token_id }); await workerBinding();
        } else await enable(!!prefs.public_alerts, !!prefs.account_alerts);
        status(message, saved() ? "Notifications enabled for this device." : "Phone notifications are off.");
        apply.textContent = saved() ? "Update Preferences" : "Enable Notifications"; off.hidden = !saved();
      } catch (error) {
        if (error.status === 404 && saved()) {
          await disable().catch(() => {}); off.hidden = true; apply.textContent = "Enable Notifications";
          status(message, "This device's subscription has ended. Enable notifications again to reconnect it.");
        } else status(message, error.message);
      } finally { apply.disabled = false; }
    });
    const off = button("Turn Off", async () => { off.disabled = true; try { await disable(); status(message, "Phone notifications are off."); off.hidden = true; apply.textContent = "Enable Notifications"; } catch (e) { status(message, e.message); } finally { off.disabled = false; } }, true);
    off.hidden = !saved(); actions.append(apply, off); panel.prepend(title, intro); panel.append(actions, message); container.append(panel);
    const reason = capabilityMessage(); if (reason) { apply.disabled = true; status(message, reason); }
    else config().then(cfg => { if (!cfg.push_available) { apply.disabled = !saved(); status(message, "Phone notifications are not available yet. Your FMRC inbox is still available."); } }).catch(() => status(message, "Connect to FMRC to check phone notification availability."));
  }
  const bellSvg = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/></svg>';
  let bell, unread = 0, inbox, pageNumber = 1, rows = [], nextPage = null;
  const guestReadsKey = "fmrc_customer_public_reads";
  const guestReads = () => parse(localStorage.getItem(guestReadsKey), []);
  const guestReadThrough = () => Number(localStorage.getItem("fmrc_customer_public_read_through")) || 0;
  const guestHasRead = row => Number(row.id) <= guestReadThrough() || guestReads().includes(row.id);
  async function badge(count) {
    unread = count; if (bell) { const badge = bell.querySelector(".fmrc-inbox-badge"); badge.hidden = !count; badge.textContent = count > 99 ? "99+" : count; bell.setAttribute("aria-label", `Notifications${count ? `, ${count} unread` : ""}`); }
    if (standalone()) try { if (count) await navigator.setAppBadge?.(count); else await navigator.clearAppBadge?.(); } catch {}
  }
  async function refreshBadge() {
    if (app !== "customer") return;
    try {
      const cfg = await config(); if (!cfg.inbox_available) return;
      if (token()) { const data = await request("/customer/notifications/unread-count", { authenticated: true }); await badge(data.unread_count); }
      else { const data = await request(`/customer/notifications/unread-count?after=${guestReadThrough()}&read_ids=${guestReads().join(",")}`); await badge(data.unread_count); }
    } catch {}
  }
  async function markRead(row) {
    if (token()) await request(`/customer/notifications/${row.id}/read`, { method: "PATCH", authenticated: true });
    else localStorage.setItem(guestReadsKey, JSON.stringify([...new Set([...guestReads(), row.id])].slice(-200)));
    row.read_at = new Date().toISOString(); await refreshBadge();
  }
  async function loadInbox(append = false) {
    const list = inbox?.querySelector(".fmrc-inbox-list"); if (!list) return;
    if (!append) { pageNumber = 1; rows = []; list.textContent = "Loading notifications…"; }
    try {
      const data = await request(`/customer/notifications?page=${pageNumber}`, { authenticated: !!token() });
      rows.push(...data.data); nextPage = data.next_page_url; list.replaceChildren();
      rows.forEach(row => {
        const item = document.createElement("article"); item.className = "fmrc-inbox-item";
        const isRead = row.read_at || (!token() && guestHasRead(row)); item.classList.toggle("is-unread", !isRead);
        const title = document.createElement("h3"); title.textContent = row.title;
        const text = document.createElement("p"); text.textContent = row.message;
        const time = document.createElement("time"); time.textContent = new Date(row.published_at.replace(" ", "T") + (/[Z+]\d*:?\d*$/.test(row.published_at) ? "" : "Z")).toLocaleString();
        const action = button("View Update", async () => {
          action.disabled = true;
          try { await markRead(row); location.href = url(row.target); } catch { action.disabled = false; inbox.querySelector(".fmrc-inbox-status").textContent = "Please reconnect to open this update."; }
        }, true);
        const readButton = button("Mark Read", async () => { try { await markRead(row); item.classList.remove("is-unread"); readButton.remove(); } catch { inbox.querySelector(".fmrc-inbox-status").textContent = "Please reconnect to mark this update as read."; } }, true);
        item.append(title, text, time, action); if (!isRead) item.append(readButton); list.append(item);
        const requested = new URLSearchParams(location.search).get("notification"); if (requested === String(row.id)) { item.classList.add("is-selected"); setTimeout(() => item.scrollIntoView({ block: "nearest" }), 0); }
      });
      if (!rows.length) list.textContent = "You're all caught up. New FMRC updates will appear here.";
      inbox.querySelector(".fmrc-inbox-more").hidden = !nextPage;
      const requested = new URLSearchParams(location.search).get("notification");
      if (requested && rows.some(row => String(row.id) === requested)) sessionStorage.removeItem(pendingKey);
      inbox.querySelector(".fmrc-inbox-status").textContent = requested && !rows.some(row => String(row.id) === requested) ? (token() ? "This update may be older or no longer available. Load earlier updates to check." : "Sign in to view private account updates.") : "";
    } catch (e) { list.textContent = "Notifications couldn't be loaded. Please reconnect and retry."; inbox.querySelector(".fmrc-inbox-status").textContent = e.status === 401 ? "Sign in to view private account updates." : ""; }
  }
  async function openInbox() {
    if (inbox?.open) return;
    inbox = dialog("Notifications", token() ? "Your account updates, announcements and promotions." : "FMRC announcements and promotions. Sign in for your order and appointment updates.");
    inbox.classList.add("fmrc-inbox-dialog");
    const actions = document.createElement("div"); actions.className = "fmrc-app-actions";
    actions.append(button("Refresh", () => loadInbox(), true), button("Mark All Read", async () => {
      try { if (token()) await request("/customer/notifications/mark-all-read", { method: "POST", authenticated: true }); else { const data = await request("/customer/notifications"); const latest = Math.max(guestReadThrough(), ...data.data.map(row => Number(row.id))); localStorage.setItem("fmrc_customer_public_read_through", String(latest)); localStorage.removeItem(guestReadsKey); } await loadInbox(); await refreshBadge(); } catch { inbox.querySelector(".fmrc-inbox-status").textContent = "Please reconnect to mark updates as read."; }
    }, true));
    if (!token()) {
      const signIn = document.createElement("a"); signIn.className = "fmrc-app-button"; signIn.href = loginDestination("../customer-auth/auth.html#login"); signIn.textContent = "Sign In"; actions.append(signIn);
    }
    const list = document.createElement("div"); list.className = "fmrc-inbox-list"; const message = document.createElement("p"); message.className = "fmrc-inbox-status"; message.setAttribute("role", "status");
    const more = button("Earlier Updates", () => { pageNumber++; void loadInbox(true); }, true); more.classList.add("fmrc-inbox-more"); more.hidden = true;
    inbox.append(actions, message, list, more); controls(inbox); await loadInbox();
  }
  function inject() {
    document.querySelectorAll("[data-fmrc-install]").forEach(action => { action.hidden = !installDevice || standalone(); });
    const installationHint = document.querySelector("[data-fmrc-install-hint]");
    if (installationHint && !installDevice && !installationHint.dataset.desktopHint) { installationHint.dataset.desktopHint = "1"; installationHint.textContent = "Open FMRC on an iPhone with iOS 16.4 or later, or a supported Android phone, to install the app."; }
    document.querySelectorAll(app === "customer" ? ".mobile-sidebar .sidebar-footer-actions" : ".sidebar-footer").forEach(footer => {
      if (footer.querySelector(".fmrc-install-button") || standalone() || !installDevice) return;
      const b = button("Install App", install, true); b.classList.add("fmrc-install-button"); b.innerHTML = '<span aria-hidden="true">↓</span><span class="nav-label">Install App</span>'; footer.prepend(b);
    });
    // The navbar announcement bell belongs to customer-announcements.js.
    // App notifications have their own phone-sidebar entry and never replace it.
    if (app === "customer" && installDevice && !bell) {
      const footer = document.querySelector(".mobile-sidebar .sidebar-footer-actions");
      if (footer) {
        bell = button("App Notifications", () => {
          document.querySelector(".mobile-sidebar .sidebar-close-btn")?.click();
          void openInbox();
        }, true);
        bell.classList.add("fmrc-app-inbox-button");
        bell.innerHTML = `${bellSvg}<span class="nav-label">App Notifications</span><span class="fmrc-inbox-badge" hidden></span>`;
        bell.setAttribute("aria-label", "App notifications");
        footer.insertBefore(bell, footer.querySelector(".fmrc-install-button")?.nextSibling || footer.firstChild);
        void refreshBadge();
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
    if (token()) {
      try { await request("/admin/session", { authenticated: true, device: false }); return location.replace(`${prefix}${role()}-page/dashboard.html${query}`); } catch {}
    }
    location.replace(`${prefix}admin-auth/auth.html${query}`);
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
    const d = dialog(record.title, record.message); d.append(button("View Update", () => { d.close(); void openNotification(id); }));
  }
  window.FMRCApp = { app, prefix, inApp, installDevice, url, install, enable, disable, logout, syncAccount, openInbox, controls, launch, loginDestination, consumeTeamNotification, updateBadge: badge };
  if (installDevice && !localAppOrigin()) { const manifest = document.createElement("link"); manifest.rel = "manifest"; manifest.href = `${prefix}manifest.webmanifest`; document.head.append(manifest); }
  const touch = document.querySelector('link[rel="apple-touch-icon"]') || document.createElement("link"); touch.rel = "apple-touch-icon"; touch.href = `${prefix}icons/apple-touch-icon.png`; if (!touch.isConnected) document.head.append(touch);
  const theme = document.querySelector('meta[name="theme-color"]') || document.createElement("meta"); theme.name = "theme-color"; theme.content = app === "customer" ? "#fff9ed" : "#6b202b"; if (!theme.isConnected) document.head.append(theme);
  window.addEventListener("beforeinstallprompt", event => { event.preventDefault(); if (installDevice) installPrompt = event; });
  window.addEventListener("appinstalled", () => document.querySelectorAll(".fmrc-install-button,.fmrc-settings-install,[data-fmrc-install]").forEach(b => b.remove()));
  matchMedia("(display-mode: standalone)").addEventListener?.("change", () => { if (standalone()) document.querySelectorAll(".fmrc-install-button,.fmrc-settings-install,[data-fmrc-install]").forEach(b => b.remove()); else inject(); });
  window.addEventListener("storage", event => { if (event.key === storageKey) { void workerBinding(); } if (/token$|user_info$|customer_user/.test(event.key || "")) { void syncAccount(); void refreshBadge(); } });
  window.addEventListener("admin:session-updated", syncAccount);
  window.addEventListener("online", () => { configuration = null; void refreshBadge(); void syncAccount(); });
  document.addEventListener("click", event => {
    if (!inApp) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor && !anchor.getAttribute("href").startsWith("#")) anchor.href = url(anchor.href);
  }, true);
  document.addEventListener("submit", event => { if (inApp && event.target instanceof HTMLFormElement) event.target.action = url(event.target.action); }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { void refreshBadge(); void syncAccount(); } });
  const boot = async () => {
    if (app === "team" && /\/(admin|staff)-page\//.test(location.pathname) && token()) localStorage.setItem("fmrc_pwa_team_role", role());
    inject(); const observer = new MutationObserver(inject); observer.observe(document.body, { childList: true, subtree: true });
    await registerWorker().catch(() => null); if (saved()) { await workerBinding(); await syncAccount(); }
    if (app === "customer" && new URLSearchParams(location.search).has("notification")) await openInbox();
    setInterval(() => { if (!document.hidden) { void refreshBadge(); void syncAccount(); } }, 60000);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else void boot();
})();
