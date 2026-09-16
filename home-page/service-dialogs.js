/* Shared keyboard focus for the service details and stacked image preview. */
document.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.querySelector(".products-toolbar .search-input");
  // Shared main.js owns showing, dismissal and scroll locking. Observe those
  // states here so keyboard focus follows the Services dialog stack as well.
  const detailDialog = document.getElementById("serviceModal");
  const imageDialog = document.getElementById("serviceImageLightboxModal");
  const dialogLayers = [detailDialog, imageDialog]
    .filter(Boolean)
    .map((element) => ({ element, open: false, opener: null }));
  let coveredDetailState = null;

  const isOpen = (element) => element?.classList.contains("show-modal");
  const topServiceDialog = () =>
    [...dialogLayers].reverse().find((layer) => isOpen(layer.element))?.element;

  const canReceiveFocus = (element) => {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;
    if (element.matches(":disabled") || element.closest("[inert], [hidden]")) return false;
    if (element.closest("#serviceModal:not(.show-modal), #serviceImageLightboxModal:not(.show-modal)")) return false;
    return element.getClientRects().length > 0 &&
      getComputedStyle(element).visibility === "visible";
  };

  const focusTargets = (dialog) =>
    Array.from(dialog.querySelectorAll("a[href], button, input, select, textarea, [tabindex]"))
      .filter((element) => element.tabIndex >= 0 && canReceiveFocus(element));

  const focusFirst = (dialog) => {
    const first = focusTargets(dialog)[0];
    if (first) first.focus({ preventScroll: true });
  };

  // Capture runs before main.js moves focus to the preview's close button.
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const imageTrigger = event.target.closest(".service-image-trigger, .service-modal-image-trigger");
    const detailTrigger = event.target.closest(".service-card .open-modal-btn");
    const dialog = imageTrigger ? imageDialog : detailTrigger ? detailDialog : null;
    const layer = dialogLayers.find((candidate) => candidate.element === dialog);
    if (layer) layer.opener = imageTrigger || detailTrigger;
  }, true);

  const syncDialogFocus = () => {
    const opened = dialogLayers.filter((layer) => !layer.open && isOpen(layer.element));
    const closed = dialogLayers.filter((layer) => layer.open && !isOpen(layer.element));
    dialogLayers.forEach((layer) => { layer.open = isOpen(layer.element); });

    // Only the top dialog should be exposed while its image preview is open.
    // Restore exact prior values, including a preexisting inert attribute.
    const detailCovered = isOpen(detailDialog) && isOpen(imageDialog);
    if (detailCovered && !coveredDetailState) {
      coveredDetailState = {
        inert: detailDialog.getAttribute("inert"),
        ariaHidden: detailDialog.getAttribute("aria-hidden"),
      };
      detailDialog.setAttribute("inert", "");
      detailDialog.setAttribute("aria-hidden", "true");
    } else if (!detailCovered && coveredDetailState) {
      for (const [attribute, value] of [
        ["inert", coveredDetailState.inert],
        ["aria-hidden", coveredDetailState.ariaHidden],
      ]) {
        if (value === null) detailDialog.removeAttribute(attribute);
        else detailDialog.setAttribute(attribute, value);
      }
      coveredDetailState = null;
    }

    const topDialog = topServiceDialog();
    if (opened.length && topDialog) {
      if (!topDialog.contains(document.activeElement)) focusFirst(topDialog);
    } else if (closed.length) {
      const opener = [...closed].reverse()
        .map((layer) => layer.opener)
        .find((element) => canReceiveFocus(element) && (!topDialog || topDialog.contains(element)));
      if (opener) opener.focus({ preventScroll: true });
      else if (topDialog) focusFirst(topDialog);
      else if (canReceiveFocus(searchInput)) searchInput.focus({ preventScroll: true });
    }
  };

  const dialogFocusObserver = new MutationObserver(syncDialogFocus);
  dialogLayers.forEach(({ element }) => {
    dialogFocusObserver.observe(element, { attributes: true, attributeFilter: ["class"] });
  });
  syncDialogFocus();

  document.addEventListener("keydown", (event) => {
    // Leave Escape exclusively with the shared handler so one press closes
    // just the preview when it is stacked above the detail dialog.
    if (event.key !== "Tab") return;
    const dialog = topServiceDialog();
    if (!dialog) return;
    const activeElement = document.activeElement;
    const activeDialog = activeElement?.closest('[role="dialog"][aria-modal="true"]');
    // A shared flow may open another dialog above Services and manage its focus.
    if (activeDialog && !dialogLayers.some((layer) => layer.element === activeDialog)) return;
    const targets = focusTargets(dialog);
    if (!targets.length) {
      event.preventDefault();
      return;
    }
    const first = targets[0];
    const last = targets[targets.length - 1];
    if (!dialog.contains(activeElement) || (event.shiftKey && activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  });
});
