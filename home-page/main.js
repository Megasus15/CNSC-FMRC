document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelectorAll(".nav-link");
  const sections = document.querySelectorAll("main, section");

  const observerOptions = {
    root: null,
    rootMargin: "-40% 0px -40% 0px",
    threshold: 0,
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        if (id) {
          navLinks.forEach((link) => link.classList.remove("active"));
          const activeLink = document.querySelector(
            `.nav-link[href*="#${id}"]`,
          );
          if (activeLink) {
            activeLink.classList.add("active");
          }
        }
      }
    });
  }, observerOptions);

  sections.forEach((section) => {
    if (section.id) {
      observer.observe(section);
    }
  });

  // Modal Logic
  const modal = document.getElementById("serviceModal");
  const modalTitle = document.getElementById("modalTitle");

  document.body.addEventListener("click", function (e) {
    // Open Modal logic
    const openBtn = e.target.closest(".open-modal-btn");
    if (openBtn) {
      if (modal) {
        // Find the title of the specific card that was clicked
        const card = openBtn.closest(".service-card");
        if (card && modalTitle) {
          const title = card.querySelector(".card-title").innerText;
          modalTitle.innerText = title;
        }

        modal.classList.add("show-modal");
        document.body.style.overflow = "hidden";
      }
    }

    // Close Modal via 'X' button
    if (e.target.closest(".close-modal-btn")) {
      if (modal) {
        modal.classList.remove("show-modal");
        document.body.style.overflow = "auto";
      }
    }

    // Close Modal by clicking the dark overlay background
    if (e.target === modal) {
      modal.classList.remove("show-modal");
      document.body.style.overflow = "auto";
    }
  });
});
