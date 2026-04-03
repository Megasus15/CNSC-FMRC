document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "../admin-auth/auth.html";
    return;
  }

  const tableBody = document.getElementById("accountsTableBody");

  async function loadAccounts() {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/users", {
        headers: {
          "Authorization": "Bearer " + token,
          "Accept": "application/json"
        }
      });
      if (response.status === 401 || response.status === 403) {
         localStorage.removeItem("auth_token");
         localStorage.removeItem("user_info");
         window.location.href = "../admin-auth/auth.html";
         return;
      }
      
      const users = await response.json();
      tableBody.innerHTML = "";

      users.forEach((user, index) => {
        // If Username is empty/null, use N/A. Same for Email.
        // Wait, the prompt says "PLACE N/A IN COLUMN OF GMAIL IF THE USER CREATE HIS/HER ACCOUNT USING USERNAME."
        const displayUsername = user.username ? user.username : 'N/A';
        const displayEmail = user.email ? user.email : 'N/A';
        // Date formatting: Ex. Mar 12, 2026
        const dateObj = new Date(user.created_at);
        const displayDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        // Capitalize role
        const displayRole = user.role.charAt(0).toUpperCase() + user.role.slice(1);

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${String(index + 1).padStart(3, '0')}</td>
          <td>${user.name}</td>
          <td>${displayUsername}</td>
          <td>${displayEmail}</td>
          <td>${displayRole}</td>
          <td>${displayDate}</td>
        `;
        tableBody.appendChild(tr);
      });
    } catch (e) {
      console.error("Failed to load accounts:", e);
      tableBody.innerHTML = "<tr><td colspan='6' style='text-align: center; color: red;'>Could not load accounts. Ensure Laravel server is running.</td></tr>";
    }
  }

  loadAccounts();
});