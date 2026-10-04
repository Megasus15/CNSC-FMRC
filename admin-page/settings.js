document.addEventListener("DOMContentLoaded", () => {
  "use strict";
  const page = document.querySelector(".portal-settings");
  if (!page || !window.AdminPreferences) return;
  page.addEventListener("change", event => {
    const input = event.target;
    if (input.name === "portalTheme") window.AdminPreferences.set({ theme: input.value });
    if (input.dataset.portalPreference) window.AdminPreferences.set({ [input.dataset.portalPreference]: input.checked });
  });
  document.getElementById("settingsResetBtn").addEventListener("click", () => window.AdminPreferences.reset());
});
