# ==============================================================================
# KAMCH ERP — Safe Database Restoration Script (Windows PowerShell)
# Objective: Restores a verified backup to a separate test database by default.
# NEVER automatically overwrites the live database.
# ==============================================================================

[CmdletBinding()]
param (
    [string]$BackupFilePath = "",
    [string]$ConfigPath = "",
    [string]$TargetDatabase = "",
    [switch]$AllowOverwriteLive = $false
)

$ErrorActionPreference = "Stop"

$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDirectory) { $ScriptDirectory = (Get-Location).Path }
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDirectory)

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $ProjectRoot ".env"
}

# 1. Parse .env
$DbHost = "127.0.0.1"
$DbPort = "3306"
$DbUser = "root"
$DbPassword = ""
$LiveDbName = "kamch_erp"
$TestDbName = "kamch_erp_test"

if (Test-Path -LiteralPath $ConfigPath) {
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
                "DB_NAME" { if ($Val) { $LiveDbName = $Val; $TestDbName = "${Val}_test" } }
                "DB_TEST_NAME" { if ($Val) { $TestDbName = $Val } }
            }
        }
    }
}

$EffectiveTargetDb = if ($TargetDatabase) { $TargetDatabase } else { $TestDbName }

# SAFETY GUARD: Never restore over live database unless explicit flag given
if (($EffectiveTargetDb.ToLower() -eq $LiveDbName.ToLower()) -and (-not $AllowOverwriteLive)) {
    Write-Error "SAFETY VIOLATION: Direct restoration to live production database '$LiveDbName' is prohibited. Please target the test database '$TestDbName' instead, or pass -AllowOverwriteLive explicitly."
    exit 1
}

# 2. Locate backup file if not provided
if (-not $BackupFilePath) {
    $DefaultBackupDir = "C:\KAMCH-Backups"
    $Candidates = Get-ChildItem -Path $DefaultBackupDir -Recurse -Filter "kamch_erp_*.sql" -ErrorAction SilentlyContinue | Sort-Object CreationTime -Descending
    if ($Candidates -and $Candidates.Count -gt 0) {
        $BackupFilePath = $Candidates[0].FullName
        Write-Host "No backup file specified. Using latest found: $BackupFilePath"
    } else {
        Write-Error "No backup file found to restore. Please specify -BackupFilePath."
        exit 1
    }
}

if (-not (Test-Path -LiteralPath $BackupFilePath)) {
    Write-Error "Specified backup file does not exist: $BackupFilePath"
    exit 1
}

# 3. Locate mysql.exe
$MysqlPath = $null
$StandardPaths = @(
    "mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 8.4\bin\mysql.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe",
    "C:\xampp\mysql\bin\mysql.exe",
    "C:\laragon\bin\mysql\bin\mysql.exe"
)

foreach ($PathPattern in $StandardPaths) {
    if ($PathPattern -eq "mysql.exe") {
        $Cmd = Get-Command "mysql.exe" -ErrorAction SilentlyContinue
        if ($Cmd) { $MysqlPath = $Cmd.Source; break }
    } else {
        if (Test-Path -LiteralPath $PathPattern) { $MysqlPath = $PathPattern; break }
    }
}

if (-not $MysqlPath) {
    Write-Error "mysql.exe client tool could not be located in PATH or standard installation locations."
    exit 1
}

# 4. Verify Checksum if .sha256 exists
$ShaFile = "$BackupFilePath.sha256"
if (Test-Path -LiteralPath $ShaFile) {
    $ExpectedHash = (Get-Content -LiteralPath $ShaFile -Raw).Trim().Split([char[]]@(' ', "`t", "`r", "`n"), [System.StringSplitOptions]::RemoveEmptyEntries)[0]
    $ActualHash = (Get-FileHash -LiteralPath $BackupFilePath -Algorithm SHA256).Hash
    if ($ActualHash -ne $ExpectedHash) {
        Write-Error "Checksum verification failed! File may be corrupted or altered. (Expected: $ExpectedHash, Actual: $ActualHash)"
        exit 1
    }
    Write-Host "SHA-256 Checksum verified: $ActualHash"
}

# 5. Create Target Database
$env:MYSQL_PWD = $DbPassword
Write-Host "Creating target database '$EffectiveTargetDb' if not exists..."

$CreateDbArgs = "-h $DbHost -P $DbPort -u $DbUser -e ""CREATE DATABASE IF NOT EXISTS \`$EffectiveTargetDb\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"""
Start-Process -FilePath $MysqlPath -ArgumentList $CreateDbArgs -Wait -NoNewWindow

# 6. Execute Restoration
Write-Host "Restoring backup '$BackupFilePath' into '$EffectiveTargetDb'..."

$ProcessStartInfo = New-Object System.Diagnostics.ProcessStartInfo
$ProcessStartInfo.FileName = $MysqlPath
$ProcessStartInfo.Arguments = "-h $DbHost -P $DbPort -u $DbUser --default-character-set=utf8mb4 $EffectiveTargetDb"
$ProcessStartInfo.RedirectStandardInput = $true
$ProcessStartInfo.RedirectStandardError = $true
$ProcessStartInfo.UseShellExecute = $false
$ProcessStartInfo.CreateNoWindow = $true

$Process = New-Object System.Diagnostics.Process
$Process.StartInfo = $ProcessStartInfo
$Process.Start() | Out-Null

$FileStream = [System.IO.File]::OpenRead($BackupFilePath)
$FileStream.CopyTo($Process.StandardInput.BaseStream)
$FileStream.Close()
$Process.StandardInput.Close()

$StdErr = $Process.StandardError.ReadToEnd()
$Process.WaitForExit()
$env:MYSQL_PWD = $null

if ($Process.ExitCode -ne 0) {
    Write-Error "Restoration failed with code $($Process.ExitCode): $StdErr"
    exit 1
}

Write-Host "Restoration executed successfully into '$EffectiveTargetDb'!"

# 7. Verification Query
$env:MYSQL_PWD = $DbPassword
$VerifyArgs = "-h $DbHost -P $DbPort -u $DbUser $EffectiveTargetDb -e ""SHOW TABLES;"""
Start-Process -FilePath $MysqlPath -ArgumentList $VerifyArgs -Wait -NoNewWindow
$env:MYSQL_PWD = $null

Write-Host "Safe test restoration and verification completed successfully."
exit 0
