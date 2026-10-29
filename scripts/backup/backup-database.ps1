# ==============================================================================
# KAMCH ERP — Automated MySQL Database Backup Script
# Objective: Nightly complete backup of kamch_erp database with USB sync & SHA-256 verification
# ==============================================================================

[CmdletBinding()]
param (
    [string]$ConfigPath = "",
    [string]$LocalBackupDir = "C:\KAMCH-Backups",
    [string]$UsbBackupDir = "",
    [int]$RetentionDays = 7
)

$ErrorActionPreference = "Stop"

# Determine script directory and project root reliably
$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDirectory) { $ScriptDirectory = (Get-Location).Path }
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDirectory)

# Resolve default .env path if not explicitly provided
if (-not $ConfigPath) {
    $ConfigPath = Join-Path $ProjectRoot ".env"
}

# Ensure Local Backup and Log Directories Exist
$LogDir = Join-Path $LocalBackupDir "logs"
if (-not (Test-Path $LocalBackupDir)) {
    New-Item -ItemType Directory -Path $LocalBackupDir -Force | Out-Null
}
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$LogFile = Join-Path $LogDir "backup.log"

function Write-BackupLog {
    param (
        [string]$Level,    # INFO, SUCCESS, WARNING, ERROR
        [string]$Target,   # INTERNAL, USB, RETENTION, SYSTEM
        [string]$Message
    )
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $LogLine = "[$Timestamp] [$Level] [$Target] $Message"
    Write-Host $LogLine

    try {
        # Rotate log if size exceeds 5 MB
        if (Test-Path -LiteralPath $LogFile) {
            $LogSize = (Get-Item -LiteralPath $LogFile).Length
            if ($LogSize -gt (5 * 1024 * 1024)) {
                $RotatedLog = Join-Path $LogDir "backup.log.1"
                if (Test-Path -LiteralPath $RotatedLog) { Remove-Item -LiteralPath $RotatedLog -Force }
                Rename-Item -LiteralPath $LogFile -NewName "backup.log.1" -Force
            }
        }
        Add-Content -LiteralPath $LogFile -Value $LogLine -Encoding utf8
    } catch {
        Write-Warning "Could not write to log file: $_"
    }
}

Write-BackupLog "INFO" "SYSTEM" "Starting KAMCH ERP automated database backup procedure..."

# 1. Parse Database Credentials securely from .env (never hardcoded, never logged)
$DbHost = "127.0.0.1"
$DbPort = "3306"
$DbUser = "root"
$DbPassword = ""
$DbName = "kamch_erp"
$ConfiguredUsbDir = $UsbBackupDir

$ConfigExists = $false
if ($ConfigPath) {
    try {
        $ConfigExists = Test-Path -LiteralPath $ConfigPath
    } catch {
        $ConfigExists = $false
    }
}

if ($ConfigExists) {
    Get-Content -LiteralPath $ConfigPath | ForEach-Object {
        $Line = $_.Trim()
        if ($Line -and (-not $Line.StartsWith("#")) -and ($Line.Contains("="))) {
            $Parts = $Line.Split("=", 2)
            $Key = $Parts[0].Trim()
            $Val = $Parts[1].Trim().Trim('"').Trim("'")
            switch ($Key) {
                "DB_HOST" { if ($Val) { $DbHost = $Val } }
                "DB_PORT" { if ($Val) { $DbPort = $Val } }
                "DB_USER" { if ($Val) { $DbUser = $Val } }
                "DB_PASSWORD" { $DbPassword = $Val }
                "DB_NAME" { if ($Val) { $DbName = $Val } }
                "BACKUP_USB_DIR" { if (-not $ConfiguredUsbDir -and $Val) { $ConfiguredUsbDir = $Val } }
            }
        }
    }
    Write-BackupLog "INFO" "SYSTEM" "Loaded database configuration from $ConfigPath (target: $DbName on ${DbHost}:${DbPort}, user: $DbUser)"
} else {
    Write-BackupLog "WARNING" "SYSTEM" "Configuration file not found at $ConfigPath; using default localhost parameters."
}

# 2. Locate mysqldump.exe executable
$MysqldumpPath = $null
$StandardPaths = @(
    "mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 5.7\bin\mysqldump.exe",
    "C:\xampp\mysql\bin\mysqldump.exe",
    "C:\laragon\bin\mysql\mysql-*\bin\mysqldump.exe",
    "C:\wamp64\bin\mysql\mysql*\bin\mysqldump.exe"
)

foreach ($PathPattern in $StandardPaths) {
    if ($PathPattern -eq "mysqldump.exe") {
        $Cmd = Get-Command "mysqldump.exe" -ErrorAction SilentlyContinue
        if ($Cmd) {
            $MysqldumpPath = $Cmd.Source
            break
        }
    } else {
        $Resolved = Resolve-Path $PathPattern -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Resolved -and (Test-Path -LiteralPath $Resolved.Path)) {
            $MysqldumpPath = $Resolved.Path
            break
        }
    }
}

if (-not $MysqldumpPath) {
    $ErrMsg = "mysqldump.exe could not be located in PATH or standard installation directories. Please verify MySQL Server or XAMPP is installed."
    Write-BackupLog "ERROR" "INTERNAL" $ErrMsg
    exit 1
}

Write-BackupLog "INFO" "SYSTEM" "Using mysqldump binary: $MysqldumpPath"

# 3. Define backup filenames
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupFileName = "kamch_erp_backup_${Timestamp}.sql"
$TempBackupFile = Join-Path $LocalBackupDir "kamch_erp_backup_${Timestamp}.tmp"
$FinalBackupFile = Join-Path $LocalBackupDir $BackupFileName

# 4. Execute mysqldump with complete parameters
# Sets MYSQL_PWD in process environment for safe password passing without CLI exposure
$env:MYSQL_PWD = $DbPassword

$DumpArgs = @(
    "--host=$DbHost",
    "--port=$DbPort",
    "--user=$DbUser",
    "--routines",
    "--triggers",
    "--events",
    "--single-transaction",
    "--quick",
    "--max_allowed_packet=512M",
    "--hex-blob",
    $DbName
)

Write-BackupLog "INFO" "INTERNAL" "Generating complete database dump for '$DbName'..."

try {
    $ProcessStartInfo = New-Object System.Diagnostics.ProcessStartInfo
    $ProcessStartInfo.FileName = $MysqldumpPath
    $ProcessStartInfo.Arguments = ($DumpArgs -join " ")
    $ProcessStartInfo.RedirectStandardOutput = $true
    $ProcessStartInfo.RedirectStandardError = $true
    $ProcessStartInfo.UseShellExecute = $false
    $ProcessStartInfo.CreateNoWindow = $true

    $Process = New-Object System.Diagnostics.Process
    $Process.StartInfo = $ProcessStartInfo
    
    $OutputFileStream = [System.IO.File]::Create($TempBackupFile)
    $Process.Start() | Out-Null
    
    # Stream output to temporary backup file
    $Process.StandardOutput.BaseStream.CopyTo($OutputFileStream)
    $OutputFileStream.Close()

    $StdError = $Process.StandardError.ReadToEnd()
    $Process.WaitForExit()

    # Clear password environment variable immediately
    $env:MYSQL_PWD = $null

    if ($Process.ExitCode -ne 0) {
        throw "mysqldump exited with code $($Process.ExitCode): $StdError"
    }

    # 5. Verification: Check file existence, size, and dump completeness marker
    if (-not (Test-Path -LiteralPath $TempBackupFile)) {
        throw "Temporary backup file was not created on disk."
    }

    $FileItem = Get-Item -LiteralPath $TempBackupFile
    if ($FileItem.Length -le 100) {
        throw "Backup file is unexpectedly empty or contains only headers ($($FileItem.Length) bytes)."
    }

    # Verify standard completion marker in trailing lines
    $TailContent = Get-Content -LiteralPath $TempBackupFile -Tail 25 -ErrorAction SilentlyContinue | Out-String
    if (-not ($TailContent -match "Dump completed on")) {
        Write-BackupLog "WARNING" "INTERNAL" "Dump completion marker not found in trailing lines; verifying non-empty data validity."
    }

    # Rename from .tmp to official .sql file
    Move-Item -LiteralPath $TempBackupFile -Destination $FinalBackupFile -Force
    $FinalItem = Get-Item -LiteralPath $FinalBackupFile
    $FileSizeKB = [math]::Round($FinalItem.Length / 1KB, 2)

    # Compute SHA-256 Checksum
    $LocalHash = (Get-FileHash -LiteralPath $FinalBackupFile -Algorithm SHA256).Hash
    Write-BackupLog "SUCCESS" "INTERNAL" "Backup verified and saved: $BackupFileName ($FileSizeKB KB, SHA-256: $LocalHash)"

} catch {
    $env:MYSQL_PWD = $null
    if (Test-Path -LiteralPath $TempBackupFile) {
        Remove-Item -LiteralPath $TempBackupFile -Force -ErrorAction SilentlyContinue
    }
    Write-BackupLog "ERROR" "INTERNAL" "Database backup FAILED: $_. Existing verified backups were preserved."
    exit 1
}

# 6. USB External Backup Copy with SHA-256 Verification
if ($ConfiguredUsbDir) {
    try {
        # Check if USB drive letter/directory is available
        $DriveLetter = [System.IO.Path]::GetPathRoot($ConfiguredUsbDir)
        if ($DriveLetter -and (Test-Path -LiteralPath $DriveLetter)) {
            if (-not (Test-Path -LiteralPath $ConfiguredUsbDir)) {
                New-Item -ItemType Directory -Path $ConfiguredUsbDir -Force | Out-Null
            }

            $UsbDestFile = Join-Path $ConfiguredUsbDir $BackupFileName
            Copy-Item -LiteralPath $FinalBackupFile -Destination $UsbDestFile -Force

            # Compute and verify SHA-256 checksum on copied USB file
            $UsbHash = (Get-FileHash -LiteralPath $UsbDestFile -Algorithm SHA256).Hash

            if ($UsbHash -eq $LocalHash) {
                Write-BackupLog "SUCCESS" "USB" "Verified copy written to USB drive: $UsbDestFile (SHA-256 matched: $UsbHash)"

                # Prune older USB backups (retention)
                $UsbBackups = Get-ChildItem -LiteralPath $ConfiguredUsbDir -Filter "kamch_erp_backup_*.sql" | Sort-Object CreationTime -Descending
                if ($UsbBackups.Count -gt $RetentionDays) {
                    $UsbToRemove = $UsbBackups | Select-Object -Skip $RetentionDays
                    foreach ($OldUsbFile in $UsbToRemove) {
                        Remove-Item -LiteralPath $OldUsbFile.FullName -Force
                        Write-BackupLog "INFO" "RETENTION" "Pruned old USB backup: $($OldUsbFile.Name)"
                    }
                }
            } else {
                Remove-Item -LiteralPath $UsbDestFile -Force -ErrorAction SilentlyContinue
                Write-BackupLog "ERROR" "USB" "USB copy verification failed: Checksum mismatch (Local: $LocalHash, USB: $UsbHash). Internal backup is intact."
            }
        } else {
            Write-BackupLog "INFO" "USB" "Configured USB backup drive '$DriveLetter' is not currently connected. Internal backup remains verified."
        }
    } catch {
        Write-BackupLog "WARNING" "USB" "Failed to complete USB copy: $_. Internal backup remains safe and verified."
    }
} else {
    Write-BackupLog "INFO" "USB" "No external USB backup directory configured (BACKUP_USB_DIR in .env is blank). Local backup complete."
}

# 7. Retention Policy: Retain the latest 7 daily verified backups locally
try {
    $LocalBackups = Get-ChildItem -LiteralPath $LocalBackupDir -Filter "kamch_erp_backup_*.sql" | Sort-Object CreationTime -Descending
    if ($LocalBackups.Count -gt $RetentionDays) {
        $FilesToRemove = $LocalBackups | Select-Object -Skip $RetentionDays
        foreach ($OldFile in $FilesToRemove) {
            Remove-Item -LiteralPath $OldFile.FullName -Force
            Write-BackupLog "INFO" "RETENTION" "Pruned old local backup exceeding retention limit: $($OldFile.Name)"
        }
    }
    $RemainingCount = [Math]::Min($LocalBackups.Count, $RetentionDays)
    Write-BackupLog "INFO" "RETENTION" "Retention check complete. $RemainingCount verified daily backups retained in $LocalBackupDir."
} catch {
    Write-BackupLog "WARNING" "RETENTION" "Error applying retention cleanup: $_"
}

Write-BackupLog "SUCCESS" "SYSTEM" "Automated backup procedure finished successfully."
exit 0
