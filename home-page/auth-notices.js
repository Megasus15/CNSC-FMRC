(() => {
  const stack = document.getElementById("authNoticeStack");
  if (!stack) return;

  // Reserve the actual height, including wrapped phone copy and stacked notices.
  const syncHeight = () => {
    const height = Math.ceil(stack.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--auth-notice-height", `${height}px`);
    document.body.classList.toggle("has-auth-notices", height > 0);
  };

  new MutationObserver(syncHeight).observe(stack, {
    attributes: true,
    attributeFilter: ["hidden"],
    subtree: true,
  });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncHeight).observe(stack);
  }
  window.addEventListener("resize", syncHeight);
  syncHeight();
})();
