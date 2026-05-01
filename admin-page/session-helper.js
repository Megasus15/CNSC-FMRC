/**
 * Session Helper — Provides role-aware localStorage keys so that
 * Admin, Staff, and Customer sessions never overwrite each other,
 * even when running in the same browser.
 *
 * Usage:
 *   <script src="session-helper.js"></script>   (before admin-common.js)
 *   const token = window.AdminSession.getToken();
 */
(() => {
  "use strict";

  // ── Detect which portal we are on by inspecting the current URL path ──
  const currentPath = window.location.pathname.toLowerCase().replace(/\\/g, "/");
  const isStaffPortal = currentPath.includes("/staff-page/");
  const isAdminPortal = currentPath.includes("/admin-page/") || currentPath.includes("/admin-auth/");

  // Each role stores its token/info under a distinct key so sessions don't collide.
  const TOKEN_KEY = isStaffPortal ? "staff_auth_token" : "admin_auth_token";
  const INFO_KEY = isStaffPortal ? "staff_user_info" : "admin_user_info";
  const ROLE = isStaffPortal ? "staff" : "admin";

  // ── Public API exposed as window.AdminSession ──
  const AdminSession = {
    /** The detected portal role for this page ("admin" or "staff"). */
    role: ROLE,

    /** Whether this page belongs to the staff portal. */
    isStaff: isStaffPortal,

    /** Whether this page belongs to the admin portal. */
    isAdmin: isAdminPortal && !isStaffPortal,

    /** Return the stored bearer token for the current portal role, or "". */
    getToken() {
      try {
        return localStorage.getItem(TOKEN_KEY) || "";
      } catch {
        return "";
      }
    },

    /** Store the bearer token for the current portal role. */
    setToken(token) {
      try {
        localStorage.setItem(TOKEN_KEY, token);
      } catch { /* ignore storage errors (e.g. incognito) */ }
    },

    /** Return the parsed user info object for the current portal role, or null. */
    getUserInfo() {
      try {
        const raw = localStorage.getItem(INFO_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },

    /** Store the user info object for the current portal role. */
    setUserInfo(info) {
      try {
        localStorage.setItem(INFO_KEY, JSON.stringify(info));
      } catch { /* ignore */ }
    },

    /** Clear all session data for the current portal role. */
    clearSession() {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(INFO_KEY);
      } catch { /* ignore */ }
    },

    /**
     * Store token + user info for a **specific** role.
     * Called from the login page where the role is determined by the API response.
     */
    storeForRole(role, token, userInfo) {
      const rk = role === "staff" ? "staff" : "admin";
      const tk = rk === "staff" ? "staff_auth_token" : "admin_auth_token";
      const ik = rk === "staff" ? "staff_user_info" : "admin_user_info";
      try {
        localStorage.setItem(tk, token);
        localStorage.setItem(ik, JSON.stringify(userInfo));
      } catch { /* ignore */ }
    },

    /** Clear session for a specific role. */
    clearForRole(role) {
      const rk = role === "staff" ? "staff" : "admin";
      const tk = rk === "staff" ? "staff_auth_token" : "admin_auth_token";
      const ik = rk === "staff" ? "staff_user_info" : "admin_user_info";
      try {
        localStorage.removeItem(tk);
        localStorage.removeItem(ik);
      } catch { /* ignore */ }
    },

    /**
     * Migrate legacy keys if present.
     * Old code stored everything under "auth_token" / "user_info" regardless of role.
     * This one-time migration moves the value to the correct role-specific key,
     * then removes the legacy keys so they don't conflict.
     */
    migrateLegacyKeys() {
      try {
        const legacyToken = localStorage.getItem("auth_token");
        const legacyInfo = localStorage.getItem("user_info");

        if (!legacyToken) return; // nothing to migrate

        // Determine the role from cached info, fallback to admin
        let role = "admin";
        if (legacyInfo) {
          try {
            const parsed = JSON.parse(legacyInfo);
            const parsedRole = (parsed?.role || parsed?.data?.role || "").toLowerCase();
            if (parsedRole === "staff") role = "staff";
          } catch { /* ignore parse errors */ }
        }

        const tk = role === "staff" ? "staff_auth_token" : "admin_auth_token";
        const ik = role === "staff" ? "staff_user_info" : "admin_user_info";

        // Only migrate if the role-specific key doesn't already exist
        if (!localStorage.getItem(tk)) {
          localStorage.setItem(tk, legacyToken);
          if (legacyInfo) localStorage.setItem(ik, legacyInfo);
        }

        // Remove legacy keys
        localStorage.removeItem("auth_token");
        localStorage.removeItem("user_info");
      } catch { /* ignore */ }
    },
  };

  // Run migration on load
  AdminSession.migrateLegacyKeys();

  // Expose globally
  window.AdminSession = AdminSession;
})();
