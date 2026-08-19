# How to Run the CNSC-FMRC Web System

This guide is for a fresh laptop setup (Windows + Laragon). Follow it step-by-step to avoid the common errors:

- `php : The term 'php' is not recognized`
- Missing `.env` file in `backend`

## What You Need to Install

1. **[Laragon (Full Version)](https://laragon.org/download/)**
   - Includes PHP, MySQL, Apache, Composer, and Node.js.
2. **[TablePlus](https://tableplus.com/)** (or another MySQL GUI)
3. **[VS Code](https://code.visualstudio.com/)**
4. **Live Server extension** (Ritwick Dey) in VS Code

## Important Notes Before Starting

1. The `.env` file is usually **not pushed to GitHub** (this is normal and secure).
2. After cloning, each developer must create their own `.env` from `.env.example`.
3. If `php` is not recognized in VS Code terminal, use **Laragon Terminal** first (or fix PATH in troubleshooting section).

---

## Step 1: Start Laragon Services

1. Open **Laragon**.
2. Click **Start All**.
3. Make sure Apache and MySQL are running.

---

## Step 2: Create the Database

1. Open **TablePlus**.
2. Create a MySQL connection:
   - Host: `127.0.0.1` (or `localhost`)
   - Port: `3306`
   - User: `root`
   - Password: *(blank for default Laragon setup)*
3. Run this SQL:

```sql
CREATE DATABASE cnsc_fmrc_db;
```

---

## Step 3: Open Project and Prepare Backend

1. Open project folder in VS Code.
2. Open terminal and go to backend:

```bash
cd backend
```

3. If dependencies are not installed yet, run:

```bash
composer install
```

4. Create `.env` file (required):

```bash
copy .env.example .env
```

5. Generate Laravel app key:

```bash
php artisan key:generate
```

6. Open `.env` and confirm DB settings are:

```env
DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=cnsc_fmrc_db
DB_USERNAME=root
DB_PASSWORD=
```

---

## Step 4: Run Migrations and Seeders

Inside `backend`, run:

```bash
php artisan migrate --seed
```

This creates all tables and inserts default admin/cashier accounts.

---

## Step 5: Start Laravel API

Inside `backend`, run:

```bash
php artisan serve
```

Backend will run at:

`http://127.0.0.1:8000`

Keep this terminal open while testing the system.

---

## Step 6: Start Frontend (Live Server)

1. Open `home-page/main.html`.
2. Right-click and choose **Open with Live Server**.
3. Frontend URL is usually:
   - `http://127.0.0.1:5500/...`

---

## Default Test Accounts

**Admin:**
- Page: `admin-auth/auth.html`
- Username: `admin` (or `admin@cnsc.edu.ph`)
- Password: `#admin_2026!`

**Cashier:**
- Page: `admin-auth/auth.html`
- Username: `cashier` (or `cashier@cnsc.edu.ph`)
- Password: `cashier123`

**Customer:**
- Page: `home-page/main.html`
- Click the profile icon and register a new account.

---

## Fix for `php is not recognized` (Very Important)

If this appears:

```powershell
php : The term 'php' is not recognized...
```

Use one of these fixes.

### Fix A (Recommended): Use Laragon Terminal

1. Open Laragon.
2. Click **Terminal** from Laragon menu.
3. In that terminal, run:

```bash
cd C:\Users\<your-username>\Documents\GitHub\CNSC-FMRC\backend
php -v
php artisan migrate --seed
php artisan serve
```

If `php -v` works here, your setup is correct.

### Fix B: Add PHP to Windows PATH (for VS Code terminal)

1. In Laragon folder, find your PHP folder, example:
   - `C:\laragon\bin\php\php-8.x.x`
2. Copy that full folder path.
3. Open Windows Start and search: **Environment Variables**.
4. Open **Edit the system environment variables**.
5. Click **Environment Variables**.
6. Under **User variables**, select `Path` then click **Edit**.
7. Click **New** and paste the PHP folder path.
8. Click **OK** on all windows.
9. Completely close VS Code, then open it again.
10. Test in terminal:

```powershell
php -v
composer -V
```

If both commands work, run backend commands again.

---

## Common First-Time Command Order (Copy This)

Run these inside `backend`:

```bash
composer install
copy .env.example .env
php artisan key:generate
php artisan migrate --seed
php artisan serve
```

---

## Quick Checklist If Something Fails

1. Laragon `Start All` is ON.
2. Database `cnsc_fmrc_db` exists.
3. `.env` exists in `backend`.
4. `.env` DB values are correct.
5. `php -v` works in the terminal you are using.
6. Laravel server is running at `http://127.0.0.1:8000`.
7. Frontend is opened with Live Server.