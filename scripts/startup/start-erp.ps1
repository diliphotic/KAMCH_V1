# ==============================================================================
# KAMCH ERP — Supervised Windows Application Startup Script
# Features:
# 1. Single Instance Protection (no competing duplicate servers on port 3000)
# 2. MySQL Service dependency check and readiness wait
# 3. Crash supervisor with bounded restart limits (max 5 retries / 10 mins)
# 4. Safe error and startup logging to logs/app-startup.log
# ==============================================================================

[CmdletBinding()]
param (
    [string]$ProjectRoot = "",
    [int]$DefaultPort = 3000,
    [int]$MaxRestarts = 5,
    [int]$RestartDelaySec = 5,
    [int]$CrashWindowMinutes = 10
)

$ErrorActionPreference = "Continue"

# Resolve project root reliably
$ScriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ScriptDirectory) { $ScriptDirectory = (Get-Location).Path }

if (-not $ProjectRoot) {
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $ScriptDirectory)
}

$ResolvedRoot = if (Test-Path -LiteralPath $ProjectRoot) { (Resolve-Path -LiteralPath $ProjectRoot).Path } else { $ProjectRoot }

$LogDir = Join-Path $ResolvedRoot "logs"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

$StartupLog = Join-Path $LogDir "app-startup.log"

function Write-StartupLog {
    param (
        [string]$Level,
        [string]$Message
    )
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Line = "[$Timestamp] [$Level] $Message"
    Write-Host $Line

    try {
        if (Test-Path -LiteralPath $StartupLog) {
            if ((Get-Item -LiteralPath $StartupLog).Length -gt (5 * 1024 * 1024)) {
                $Rotated = Join-Path $LogDir "app-startup.log.1"
                if (Test-Path -LiteralPath $Rotated) { Remove-Item -LiteralPath $Rotated -Force }
                Rename-Item -LiteralPath $StartupLog -NewName "app-startup.log.1" -Force
            }
        }
        Add-Content -LiteralPath $StartupLog -Value $Line -Encoding utf8
    } catch {
        # Non-fatal
    }
}

Write-StartupLog "INFO" "Initiating KAMCH ERP supervisor service..."

# 1. Read .env for port and MySQL settings
$Port = $DefaultPort
$DbPort = 3306
$DbHost = "127.0.0.1"
$EnvFile = Join-Path $ResolvedRoot ".env"

if (Test-Path -LiteralPath $EnvFile) {
    Get-Content -LiteralPath $EnvFile | ForEach-Object {
        $Line = $_.Trim()
        if ($Line -and (-not $Line.StartsWith("#")) -and ($Line.Contains("="))) {
            $Parts = $Line.Split("=", 2)
            $Key = $Parts[0].Trim()
            $Val = $Parts[1].Trim().Trim('"').Trim("'")
            if ($Key -eq "PORT" -and $Val) { $Port = [int]$Val }
            if ($Key -eq "DB_PORT" -and $Val) { $DbPort = [int]$Val }
            if ($Key -eq "DB_HOST" -and $Val) { $DbHost = $Val }
        }
    }
}

Write-StartupLog "INFO" "Configuration: Port=$Port, DB Target=${DbHost}:${DbPort}"

# 2. Single-Instance Check: Prevent multiple competing copies of ERP
$ExistingListening = $null
try {
    $NetTcp = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($NetTcp) {
        $ExistingListening = $NetTcp | Select-Object -First 1
    }
} catch {
    # Fallback to netstat if Get-NetTCPConnection is unavailable on older Windows versions
    $Netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING"
    if ($Netstat) {
        $ExistingListening = $Netstat
    }
}

if ($ExistingListening) {
    Write-StartupLog "WARNING" "KAMCH ERP server is already running and listening on port $Port. Multiple competing copies will not be started."
    exit 0
}

# 3. Ensure MySQL Service is Started & Ready
Write-StartupLog "INFO" "Checking MySQL database readiness..."

$MysqlServices = @("MySQL84", "MySQL80", "MySQL57", "MySQL", "mysql", "MariaDB", "wampmysqld64")
$FoundService = $null

foreach ($ServiceName in $MysqlServices) {
    $Svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($Svc) {
        $FoundService = $Svc
        if ($Svc.Status -ne "Running") {
            Write-StartupLog "INFO" "Starting Windows MySQL service '$($Svc.Name)'..."
            try {
                Start-Service -Name $Svc.Name -ErrorAction Stop
                Start-Sleep -Seconds 2
            } catch {
                Write-StartupLog "WARNING" "Could not start MySQL service '$($Svc.Name)': $_"
            }
        } else {
            Write-StartupLog "INFO" "MySQL service '$($Svc.Name)' is currently Running."
        }
        break
    }
}

# Wait up to 30 seconds for MySQL port to become responsive
$DbHostForCheck = if ($DbHost -eq "localhost") { "127.0.0.1" } else { $DbHost }
$MysqlReady = $false
$WaitCount = 0
$MaxWait = 15 # 15 iterations x 2 sec = 30 sec

while (-not $MysqlReady -and $WaitCount -lt $MaxWait) {
    try {
        $TcpClient = New-Object System.Net.Sockets.TcpClient
        $Iar = $TcpClient.BeginConnect($DbHostForCheck, $DbPort, $null, $null)
        $Success = $Iar.AsyncWaitHandle.WaitOne(1500)
        if ($Success -and $TcpClient.Connected) {
            $TcpClient.EndConnect($Iar)
            $TcpClient.Close()
            $MysqlReady = $true
            break
        }
        $TcpClient.Close()
    } catch {
        # Waiting for DB port
    }
    Start-Sleep -Seconds 2
    $WaitCount++
}

if ($MysqlReady) {
    Write-StartupLog "SUCCESS" "MySQL database port $DbPort is reachable. Starting ERP process."
} else {
    Write-StartupLog "WARNING" "MySQL did not respond within 30 seconds. Proceeding to launch ERP with non-blocking DB reconnection."
}

# 4. Supervised Execution & Auto-Restart on Crash
$CrashTimestamps = New-Object System.Collections.Generic.List[datetime]

Set-Location $ResolvedRoot

# Determine npm runner
$NpmCmd = "npm.cmd"
if (-not (Get-Command $NpmCmd -ErrorAction SilentlyContinue)) {
    $NpmCmd = "npm"
}

while ($true) {
    Write-StartupLog "INFO" "Launching KAMCH ERP via '$NpmCmd run start'..."

    $StartTime = Get-Date

    try {
        $Process = Start-Process -FilePath $NpmCmd -ArgumentList "run", "start" -WorkingDirectory $ResolvedRoot -PassThru -NoNewWindow -Wait
        $ExitCode = $Process.ExitCode
    } catch {
        Write-StartupLog "ERROR" "Failed to invoke ERP process: $_"
        $ExitCode = 1
    }

    $EndTime = Get-Date
    $UptimeSeconds = ($EndTime - $StartTime).TotalSeconds

    Write-StartupLog "WARNING" "KAMCH ERP process exited with code $ExitCode after $([math]::Round($UptimeSeconds, 1)) seconds of execution."

    # Normal clean exit by admin
    if ($ExitCode -eq 0) {
        Write-StartupLog "INFO" "ERP process terminated normally (code 0). Supervisor exiting."
        break
    }

    # Record crash
    $Now = Get-Date
    $CrashTimestamps.Add($Now)

    # Clean crash history older than $CrashWindowMinutes
    $Cutoff = $Now.AddMinutes(-$CrashWindowMinutes)
    $RecentCrashes = $CrashTimestamps | Where-Object { $_ -gt $Cutoff }
    $CrashTimestamps.Clear()
    foreach ($C in $RecentCrashes) { $CrashTimestamps.Add($C) }

    if ($CrashTimestamps.Count -gt $MaxRestarts) {
        Write-StartupLog "ERROR" "Exceeded maximum of $MaxRestarts crashes within $CrashWindowMinutes minutes. Halting supervisor to prevent tight loop. Check logs in $LogDir."
        exit 1
    }

    Write-StartupLog "INFO" "Restarting KAMCH ERP in $RestartDelaySec seconds (Crash count in window: $($CrashTimestamps.Count)/$MaxRestarts)..."
    Start-Sleep -Seconds $RestartDelaySec
}
