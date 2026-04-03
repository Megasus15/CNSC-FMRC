# How to Run the CNSC-FMRC Web System

## Prerequisites (What to Download)
To fully run this system on your localhost, you need to download and install a few essential tools:

1. **[Laragon (Full Version)](https://laragon.org/download/)**: This provides the local server environment. It automatically includes PHP, MySQL, Apache, Composer, and Node.js—everything the backend needs.
2. **[TablePlus](https://tableplus.com/)**: A modern, easy-to-use GUI tool for managing your MySQL database.
3. **[VS Code](https://code.visualstudio.com/)**: The code editor you are already using.

## Initial Setup (Laragon & TablePlus)

### 1. Setting up Laragon
1. **Install Laragon**: Download the Laragon Full installer and run it. Accept the default settings.
2. **Start Laragon**: Open the Laragon app.
3. **Start Services**: Click the big **"Start All"** button. This starts Apache (web server) and MySQL (database server).

### 2. Setting up TablePlus (Database)
1. **Install TablePlus**: Download and install TablePlus.
2. **Create a Connection**:
   * Open TablePlus and click **"Create a new connection..."** (the `+` icon).
   * Choose **MySQL**.
   * **Name**: `Laragon Local` (or anything you like).
   * **Host**: `127.0.0.1` or `localhost`.
   * **Port**: `3306`.
   * **User**: `root`.
   * **Password**: *(Leave this completely blank! Laragon has no password by default)*.
   * Click **Test** to ensure it turns green, then click **Connect**.
3. **Create the Database**:
   * Once connected, click the **SQL** button at the top to open a query window.
   * Type: `CREATE DATABASE cnsc_fmrc_db;`
   * Click **Run Current** to execute it. Your database is now ready for Laravel!

---

This project is currently split into two parts:
1. **The Backend (Laravel):** Handles the database, user accounts, and security (API).
2. **The Frontend (HTML/CSS):** The beautiful user interface and pages you built.

Because they are separated, you need to run **both** at the same time for the login forms and databases to work perfectly.

---

## Step 1: Start Your Database
1. Open **Laragon** on your computer.
2. Click the big **"Start All"** button. This turns on MySQL so Laravel can read your data.

---

## Step 2: Start the Laravel Backend (The API)
1. Open **VS Code**.
2. Open a new Terminal (`Terminal -> New Terminal` in the top menu).
3. Navigate into your backend folder by typing:
   ```bash
   cd backend
   ```
4. **Before running the server for the first time**, set up your database tables by typing:
   ```bash
   php artisan migrate --seed
   ```
   *(This step creates all the necessary tables inside TablePlus and inserts the default admin/cashier accounts).*

5. Start the Laravel server by typing:
   ```bash
   php artisan serve
   ```
6. **Leave this terminal open!** It is now running silently in the background at **`http://127.0.0.1:8000`**. Every time someone logs in or registers, the frontend will secretly talk to this URL.

---

## Step 3: Start the Frontend Website (The Visuals)
You won't use Laravel to view your HTML. Instead, we will use the **Live Server** extension in VS Code.

1. Go to the **Extensions** tab in VS Code (the 4 squares icon on the left sidebar).
2. Search for **Live Server** (by *Ritwick Dey*) and install it if you haven't already.
3. In your VS Code file explorer, open `home-page/main.html`.
4. **Right-click** anywhere inside the HTML code and select **"Open with Live Server"**.

*Boom!* Your website will instantly pop up in your web browser. 
Your website is now running at: **`http://127.0.0.1:5500/...`** (or localhost:5500).

---

## Default Built-in Accounts to Test With

**Admin Account:**
* Open `admin-auth/auth.html` using Live Server.
* **Username:** `admin` (or `admin@cnsc.edu.ph`)
* **Password:** `admin123`

**Cashier Account:**
* Open `admin-auth/auth.html` using Live Server.
* **Username:** `cashier` (or `cashier@cnsc.edu.ph`)
* **Password:** `cashier123`

**Customer Accounts:**
* Open `home-page/main.html` using Live Server.
* Click the **Red Profile Icon** in the top right navbar. 
* It will take you to the Customer portal where you can click **"Create an account"** and test out the live registration!