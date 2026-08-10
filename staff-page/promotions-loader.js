document.addEventListener("DOMContentLoaded", async () => {
  const host = document.getElementById("staffPromotionsModule");
  if (!host) return;
  try {
    const page = await fetch("../admin-page/promotions.html", { cache: "no-store" });
    if (!page.ok) throw new Error("Unable to load campaign workspace.");
    const documentSource = new DOMParser().parseFromString(await page.text(), "text/html");
    documentSource.querySelectorAll("style").forEach((style) => document.head.appendChild(style.cloneNode(true)));
    const section = documentSource.querySelector("section.module-content");
    if (!section) throw new Error("Campaign content was not found.");
    host.innerHTML = section.innerHTML;

    if (!window.renderFMRCAnnouncementPreviewCard) {
      try {
        const custScript = await fetch("../home-page/customer-announcements.js", { cache: "no-store" });
        if (custScript.ok) {
          new Function(await custScript.text())();
        }
      } catch {
        /* Optional fallback */
      }
    }

    const script = await fetch("../admin-page/promotions.js", { cache: "no-store" });
    if (!script.ok) throw new Error("Campaign functionality was not found.");

    const scriptText = await script.text();
    const startMarker = 'document.addEventListener("DOMContentLoaded", () => {';
    const startIndex = scriptText.indexOf(startMarker);
    const endIndex = scriptText.lastIndexOf("\n});");
    if (startIndex === -1 || endIndex <= startIndex) {
      throw new Error("Campaign functionality could not be initialized.");
    }

    const scriptBody = scriptText.slice(
      startIndex + startMarker.length,
      endIndex,
    );
    await new Function(
      `return (async function () {\n${scriptBody}\n}).call(window);`,
    )();
  } catch (error) {
    console.error(error);
    host.innerHTML = '<div class="panel" style="padding:24px;color:#991b1b">Unable to load Promotions & Announcements. Please try again.</div>';
  }
});
