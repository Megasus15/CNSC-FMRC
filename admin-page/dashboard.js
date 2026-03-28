document.addEventListener("DOMContentLoaded", () => {
  // 1. Sidebar 'Admin Control' Dropdown Logic
  const adminControlBtn = document.getElementById("adminControlBtn");

  adminControlBtn.addEventListener("click", (e) => {
    e.preventDefault(); // Prevents page reload
    const hasDropdown = adminControlBtn.parentElement;
    hasDropdown.classList.toggle("open");
  });

  // 2. Profile Message Box (Popup) Logic
  const userProfile = document.querySelector(".user-profile");
  const profilePopup = document.getElementById("profilePopup");

  userProfile.addEventListener("click", (e) => {
    e.stopPropagation(); // Stops click from triggering document click immediately
    profilePopup.classList.toggle("show");
  });

  // Close the popup if clicking anywhere else on the screen
  document.addEventListener("click", (e) => {
    if (!userProfile.contains(e.target)) {
      profilePopup.classList.remove("show");
    }
  });

  // Keeps popup open if you click inside it
  profilePopup.addEventListener("click", (e) => {
    e.stopPropagation();
  });
});
