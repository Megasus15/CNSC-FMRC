document.addEventListener("DOMContentLoaded", async () => {
  const moduleHost = document.getElementById("staffProductsModule");
  if (!moduleHost) return;

  moduleHost.innerHTML = `
    <div class="admin-products-bootstrap-skeleton" role="status">
      <span class="admin-loading-sr-only">Loading product management</span>
      <div class="admin-global-skeleton-toolbar">
        <div class="admin-global-skeleton-copy">
          <span class="admin-global-skeleton-bar is-title"></span>
          <span class="admin-global-skeleton-bar is-subtitle"></span>
        </div>
        <span class="admin-global-skeleton-bar is-button"></span>
      </div>
      <div class="admin-global-skeleton-cards">
        ${Array.from(
          { length: 3 },
          () => '<div class="admin-global-skeleton-card"><span class="admin-global-skeleton-bar is-icon"></span><span class="admin-global-skeleton-bar is-card-title"></span><span class="admin-global-skeleton-bar is-card-value"></span></div>',
        ).join("")}
      </div>
      <div class="admin-global-skeleton-panel">
        <span class="admin-global-skeleton-bar is-panel-title"></span>
        ${Array.from(
          { length: 3 },
          () => '<div class="admin-global-skeleton-table-row"><span class="admin-global-skeleton-bar" style="width:28px"></span><span class="admin-global-skeleton-bar" style="width:120px"></span><span class="admin-global-skeleton-bar" style="width:100px"></span><span class="admin-global-skeleton-bar" style="width:70px"></span><span class="admin-global-skeleton-bar" style="width:60px"></span></div>',
        ).join("")}
      </div>
    </div>`;

  const adminProductsUrl = new URL(
    "../admin-page/products.html",
    window.location.href,
  ).href;

  try {
    const response = await fetch(adminProductsUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Unable to load admin products page (${response.status}).`,
      );
    }

    const html = await response.text();
    const parser = new DOMParser();
    const adminDoc = parser.parseFromString(html, "text/html");

    adminDoc.querySelectorAll("style").forEach((styleTag) => {
      const clone = document.createElement("style");
      clone.textContent = styleTag.textContent || "";
      document.head.appendChild(clone);
    });

    const adminSection = adminDoc.querySelector("section.module-content");
    if (!adminSection) {
      throw new Error("Admin products content not found.");
    }

    moduleHost.innerHTML = adminSection.innerHTML;
    window.AdminPageNumberInput?.upgrade(moduleHost);

    window.AdminTableSkeleton?.show(
      document.getElementById("productTableBody"),
      { rows: 3, columns: 11 },
    );
    window.AdminTableSkeleton?.show(
      document.getElementById("productPerformanceBody"),
      { rows: 3, columns: 6 },
    );

    const existingModals = Array.from(
      document.querySelectorAll(".modal-overlay"),
    );
    existingModals.forEach((modal) => modal.remove());

    adminDoc.querySelectorAll("div.modal-overlay").forEach((modalNode) => {
      document.body.appendChild(modalNode.cloneNode(true));
    });

    const productsScriptResponse = await fetch(
      new URL("../admin-page/products.js", window.location.href).href,
      {
        cache: "no-store",
      },
    );
    if (!productsScriptResponse.ok) {
      throw new Error(
        `Unable to load products script (${productsScriptResponse.status}).`,
      );
    }

    const scriptText = await productsScriptResponse.text();
    const startMarker = 'document.addEventListener("DOMContentLoaded", () => {';
    const startIndex = scriptText.indexOf(startMarker);
    const endIndex = scriptText.lastIndexOf("\n});");

    if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
      throw new Error("Unable to extract products script body.");
    }

    const strippedScript = scriptText.slice(
      startIndex + startMarker.length,
      endIndex,
    );

    // Run the admin product logic inside a function scope so its `return` statements remain valid.
    await new Function(
      `return (async function () {\n${strippedScript}\n}).call(window);`,
    )();
  } catch (error) {
    console.error("Staff products loader error:", error);
    moduleHost.innerHTML =
      '<div class="panel" style="padding:24px;color:#991b1b;">Unable to load product management data. Please try again.</div>';
  }
});
