# KAMCH ERP — Routine Reliability, Backup & Recovery Manual

This document provides clear operational procedures for routine maintenance, daily backups, recovery, and automated startup of the Krishna Ayurvedic Medical College & Hospital (KAMCH) ERP system.

---

## 1. Quick Status Check: Are ERP and MySQL Running?

### Check MySQL Database:
Open PowerShell or Command Prompt as Administrator and run:
```powershell
Get-Service -Name MySQL*
```
Or check if the port is listening:
```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 3306
```
*(If using XAMPP, open the XAMPP Control Panel and verify the MySQL module indicates **Running** with a green highlight).*

### Check KAMCH ERP Web Server:
1. Open your browser on the host computer or on the local Wi-Fi network and visit:
   - Host computer: `http://localhost:3000`
   - Local LAN: `http://<laptop-ip>:3000` (e.g., `http://192.168.1.15:3000`)
2. Health & Diagnostic API Endpoints:
   - System baseline: `http://localhost:3000/api/foundation`
   - Database live ping: `http://localhost:3000/api/health/database`

---

## 2. File and Log Locations

| Component | Default Storage Path | Purpose |
| :--- | :--- | :--- |
| **Daily Verified Backups** | `C:\KAMCH-Backups\` | Contains verified `.sql` backup dumps (last 7 daily snapshots). |
| **External USB Backups** | Configurable (e.g. `E:\KAMCH-Backups\`) | Mirror copies with SHA-256 checksum verification. |
| **Backup Activity Log** | `C:\KAMCH-Backups\logs\backup.log` | Records backup successes, file sizes, checksums, and USB status. |
| **Server Application Log** | `<Project-Root>\logs\server.log` | Records startup, database disconnects, and server-side errors. |
| **Startup Supervisor Log** | `<Project-Root>\logs\app-startup.log` | Records supervisor launches, MySQL waits, and crash recoveries. |

*Note: All logs automatically rotate at 5 MB and never record passwords, session cookies, tokens, or student financial cards.*

---

## 3. How to Run a Manual Database Backup

Whenever you perform a major administrative action (e.g., end-of-year billing, student batch promotion), trigger a manual backup:

### Option A: Double-Click (Fastest)
Navigate to `<Project-Root>\scripts\backup\` and double-click:
`run-backup.bat`

### Option B: PowerShell
Open PowerShell and run:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\path\to\kamch-erp\scripts\backup\backup-database.ps1"
```
*(Replace `C:\path\to\kamch-erp` with your actual project directory).*

A successful run will display:
```text
[SUCCESS] [INTERNAL] Backup verified and saved: kamch_erp_backup_20261023_020000.sql (... KB, SHA-256: ...)
[SUCCESS] [USB] Verified copy written to USB drive (SHA-256 matched: ...)
[INFO] [RETENTION] Retention check complete. 7 verified daily backups retained in C:\KAMCH-Backups.
```

---

## 4. How to Restore a Backup into a Separate Test Database

> **CRITICAL RULE:** Never overwrite the live `kamch_erp` production database directly. Always restore into a separate test database first to verify table integrity.

### Step 1: Create a test database
Open MySQL client or phpMyAdmin and create a blank test database:
```sql
CREATE DATABASE kamch_erp_test_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### Step 2: Import the verified backup file
Using Command Prompt or PowerShell:
```cmd
mysql -u root -p kamch_erp_test_restore < "C:\KAMCH-Backups\kamch_erp_backup_YYYYMMDD_HHMMSS.sql"
```
*(Enter your MySQL root password when prompted).*

### Step 3: Verify the restored data
Run the following SQL queries on `kamch_erp_test_restore` to verify tables and counts:
```sql
USE kamch_erp_test_restore;
SHOW TABLES;
SELECT COUNT(*) AS total_users FROM users;
SELECT COUNT(*) AS total_students FROM students;
SELECT COUNT(*) AS total_payments FROM fee_payments;
SELECT COUNT(*) AS total_receipts FROM fee_receipts;
```

---

## 5. Troubleshooting & Contingencies

### What to do if MySQL fails or refuses connection?
1. Open Windows Services (`services.msc`), find **MySQL80** (or your installed MySQL service), right-click and select **Restart**.
2. If using XAMPP, open XAMPP Control Panel, Stop MySQL, wait 3 seconds, and click **Start**.
3. Inspect `<Project-Root>\logs\server.log` to confirm error codes (e.g., `ECONNREFUSED` or `ER_ACCESS_DENIED_ERROR`).
4. Ensure port 3306 is not blocked by Windows Defender Firewall or occupied by another service.

### What if the external USB drive is unplugged?
- The backup script is designed to handle this gracefully:
  1. It creates and verifies the primary backup in `C:\KAMCH-Backups`.
  2. It checks for the USB drive letter.
  3. If missing, it writes an informational log entry (`USB backup drive is not currently connected`) and exits with success.
  4. Your internal backups remain completely intact and verified.

---

## 6. Configuring Windows Task Scheduler for Nightly Automatic Backups

To automate backups every night at 2:00 AM:

1. Press `Win + R`, type `taskschd.msc`, and press **Enter**.
2. In the right pane, click **Create Task...** (not Basic Task).
3. **General Tab**:
   - Name: `KAMCH ERP - Nightly Database Backup`
   - Select: **Run whether user is logged on or not**
   - Check: **Run with highest privileges**
4. **Triggers Tab**:
   - Click **New...**
   - Begin the task: **On a schedule**
   - Select: **Daily**, Start time: `02:00:00 AM`, Recur every: `1 days`
   - Click **OK**.
5. **Actions Tab**:
   - Click **New...**
   - Action: **Start a program**
   - Program/script: `powershell.exe`
   - Add arguments: `-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\kamch-erp\scripts\backup\backup-database.ps1"`
   - Start in: `C:\path\to\kamch-erp\scripts\backup`
   - Click **OK**.
6. **Conditions Tab**:
   - Uncheck "Stop if the computer switches to battery power".
   - Check "Wake the computer to run this task" (optional).
7. **Settings Tab**:
   - Check "If the task fails, restart every: 10 minutes", Attempt up to: `3` times.
8. Click **OK** and enter your Windows admin credentials when prompted.

---

## 7. Configuring Automatic ERP Startup on Windows Boot

### Method 1: Windows Startup Folder (Simplest for Desktop / Laptop)
1. Press `Win + R`, type `shell:startup`, and press **Enter**.
2. Create a shortcut to `<Project-Root>\scripts\startup\start-erp.bat`.
3. Right-click the shortcut -> **Properties** -> Run: **Minimized** (optional, keeps window tidy).
4. When Windows boots and you sign in, `start-erp.bat` will automatically verify MySQL is running, start the server, and monitor it for crashes.

### Method 2: Windows Task Scheduler (Runs on Boot Without User Sign-in)
1. Open Task Scheduler (`taskschd.msc`).
2. Click **Create Task...**:
   - Name: `KAMCH ERP - Application Service`
   - Run whether user is logged on or not, with highest privileges.
3. **Triggers**:
   - At startup (or At log on).
4. **Actions**:
   - Program/script: `cmd.exe`
   - Add arguments: `/c "C:\path\to\kamch-erp\scripts\startup\start-erp.bat"`
   - Start in: `C:\path\to\kamch-erp`
5. Click **OK**.

---

## 8. Verifying Automatic Startup After Restarting Windows

1. Restart your Windows computer.
2. Sign in to Windows.
3. Open PowerShell and verify ERP is listening:
   ```powershell
   Get-NetTCPConnection -LocalPort 3000 -State Listen
   ```
4. Check `<Project-Root>\logs\app-startup.log` to confirm startup:
   ```text
   [INFO] Configuration: Port=3000, DB Target=127.0.0.1:3306
   [SUCCESS] MySQL database port 3306 is reachable. Starting ERP process.
   [INFO] Launching KAMCH ERP via 'npm.cmd run start'...
   ```
5. From your phone or another computer on the same Wi-Fi, open `http://<laptop-ip>:3000` to confirm full institutional access.
