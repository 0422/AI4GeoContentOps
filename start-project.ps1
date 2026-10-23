# 2026-10-24：本次修改原因：一键清理本项目旧 API、Worker、Vite 进程，再启动三个服务并验证实际在线版本。
param(
    [string]$PythonExe = '',
    [string]$NodeExe = '',
    # 2026-10-24：本次修改原因：先只读预览将清理的进程，方便核对不会误停其他项目。
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot 'backend'
$frontendDir = Join-Path $projectRoot 'frontend'
$viteScript = Join-Path $frontendDir 'node_modules\vite\bin\vite.js'
$logDir = Join-Path $backendDir 'data\service-logs'

if (-not $PythonExe) {
    $learnerPython = 'E:\pySpace\anaconda\envs\learner\python.exe'
    # if ($env:CONDA_PREFIX -and (Test-Path -LiteralPath (Join-Path $env:CONDA_PREFIX 'python.exe'))) { $PythonExe = Join-Path $env:CONDA_PREFIX 'python.exe' } elseif (Test-Path -LiteralPath $learnerPython) { ... } # 2026-10-24：原环境选择顺序留作对照。
    # 2026-10-24：本次修改原因：双击时可能只激活 base，优先使用项目文档指定的 learner 解释器。
    if (Test-Path -LiteralPath $learnerPython) {
        $PythonExe = $learnerPython
    } elseif ($env:CONDA_PREFIX -and (Test-Path -LiteralPath (Join-Path $env:CONDA_PREFIX 'python.exe'))) {
        $PythonExe = Join-Path $env:CONDA_PREFIX 'python.exe'
    } else {
        $PythonExe = (Get-Command python.exe -ErrorAction Stop).Source
    }
}
if (-not $NodeExe) { $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw "Python not found: $PythonExe" }
if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw "Node not found: $NodeExe" }
if (-not (Test-Path -LiteralPath $viteScript -PathType Leaf)) {
    throw "Vite not installed. Run 'npm install' in $frontendDir first."
}

# 2026-10-24：本次修改原因：只清理可识别的项目进程；端口属于其他程序时停止，避免误杀。
function Get-ProcessRecords {
    try { return @(Get-CimInstance Win32_Process -ErrorAction Stop) }
    catch { throw 'Cannot inspect processes. Run this launcher from a terminal allowed to read process information.' }
}

function Get-ListeningIds([int]$Port) {
    $pattern = '^\s*TCP\s+\S+:' + $Port + '\s+\S+\s+LISTENING\s+(\d+)\s*$'
    return @(netstat -ano -p tcp | ForEach-Object {
        if ($_ -match $pattern) { [int]$Matches[1] }
    } | Sort-Object -Unique)
}

function Has-ProjectPath([string]$CommandLine, [string]$Path) {
    if (-not $CommandLine) { return $false }
    $normalizedCommand = $CommandLine.Replace('/', '\')
    # $normalizedPath = $Path.Replace('/', '\').TrimEnd('\') + '\'; return $normalizedCommand.IndexOf($normalizedPath, [StringComparison]::OrdinalIgnoreCase) -ge 0  # 2026-10-24：原仅匹配目录前缀的逻辑留作对照。
    # 2026-10-24：本次修改原因：进程参数中的项目路径可能恰好位于参数末尾。
    $normalizedPath = $Path.Replace('/', '\').TrimEnd('\')
    $index = $normalizedCommand.IndexOf($normalizedPath, [StringComparison]::OrdinalIgnoreCase)
    if ($index -lt 0) { return $false }
    $end = $index + $normalizedPath.Length
    return $end -eq $normalizedCommand.Length -or $normalizedCommand[$end] -in @(' ', '"', '\')
}

$processRecords = Get-ProcessRecords
$targetIds = [System.Collections.Generic.HashSet[int]]::new()
$stoppedIds = [System.Collections.Generic.HashSet[int]]::new()

function Add-TargetTree([int]$ProcessId) {
    foreach ($child in @($processRecords | Where-Object { $_.ParentProcessId -eq $ProcessId })) {
        if ($child.Name -match '^(python|pythonw|node)\.exe$') {
            Add-TargetTree ([int]$child.ProcessId)
        }
    }
    if ($processRecords | Where-Object { $_.ProcessId -eq $ProcessId }) {
        [void]$targetIds.Add($ProcessId)
    }
}

function Stop-TargetTree([int]$ProcessId) {
    # foreach ($child in @($processRecords | Where-Object { $_.ParentProcessId -eq $ProcessId })) { if ($targetIds.Contains([int]$child.ProcessId)) { Stop-TargetTree ([int]$child.ProcessId) } }  # 2026-10-24：原先停子进程的顺序留作对照。
    # 2026-10-24：本次修改原因：先停 Uvicorn 重载监视器，避免它在子进程退出后立即再生一个旧服务。
    if ($targetIds.Contains($ProcessId) -and $stoppedIds.Add($ProcessId)) {
        $running = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
        if ($running) {
            Write-Host "Stopping old project process $ProcessId ($($running.ProcessName))"
            Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        }
    }
    foreach ($child in @($processRecords | Where-Object { $_.ParentProcessId -eq $ProcessId })) {
        if ($targetIds.Contains([int]$child.ProcessId)) { Stop-TargetTree ([int]$child.ProcessId) }
    }
}

$apiPortOwners = @(Get-ListeningIds 8000)
if ($apiPortOwners.Count -gt 0) {
    try { $apiSpec = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 4 }
    catch { throw 'Port 8000 is occupied, but its API identity could not be verified. No process was stopped.' }
    if ($apiSpec.info.title -ne 'AI4GeoContentOps') {
        throw 'Port 8000 belongs to another application. No process was stopped.'
    }
    foreach ($ownerId in $apiPortOwners) {
        $owner = $processRecords | Where-Object { $_.ProcessId -eq $ownerId } | Select-Object -First 1
        if ($owner -and $owner.CommandLine -match 'uvicorn\s+app\.main:app') {
            Add-TargetTree ([int]$ownerId)
            continue
        }
        # 2026-10-24：本次修改原因：Windows 重载器退出后，旧工作进程可能仍持有其父 PID 的监听套接字。
        $orphanWorkers = @($processRecords | Where-Object {
            $_.ParentProcessId -eq $ownerId -and $_.Name -match '^python(w)?\.exe$' -and
            $_.CommandLine -like '*multiprocessing.spawn*'
        })
        if ($orphanWorkers.Count -eq 0) {
            throw "Port 8000 owner $ownerId is not a recognizable project API process. No process was stopped."
        }
        foreach ($orphan in $orphanWorkers) { Add-TargetTree ([int]$orphan.ProcessId) }
    }
}

# 2026-10-24：本次修改原因：新启动命令携带项目绝对路径，后续重启可准确识别同项目服务。
foreach ($processRecord in $processRecords) {
    if ($processRecord.CommandLine -match 'uvicorn\s+app\.main:app' -and
        (Has-ProjectPath $processRecord.CommandLine $backendDir)) {
        Add-TargetTree ([int]$processRecord.ProcessId)
    }
    if ($processRecord.Name -eq 'node.exe' -and $processRecord.CommandLine -match 'vite[\\/]bin[\\/]vite\.js' -and
        (Has-ProjectPath $processRecord.CommandLine $frontendDir)) {
        Add-TargetTree ([int]$processRecord.ProcessId)
    }
}

$workerRecords = @($processRecords | Where-Object {
    $_.Name -match '^python(w)?\.exe$' -and $_.CommandLine -match '\-m\s+app\.worker(\s|$)'
})
$unmarkedWorkers = @($workerRecords | Where-Object {
    -not (Has-ProjectPath $_.CommandLine $projectRoot)
})
if ($unmarkedWorkers.Count -gt 1) {
    throw 'Several unmarked app.worker processes exist. Identify them manually; no process was stopped.'
}
foreach ($workerRecord in $workerRecords) {
    if ((Has-ProjectPath $workerRecord.CommandLine $projectRoot) -or
        ($unmarkedWorkers.Count -eq 1 -and
         [string]::Equals($workerRecord.ExecutablePath, $PythonExe, [StringComparison]::OrdinalIgnoreCase))) {
        Add-TargetTree ([int]$workerRecord.ProcessId)
    } else {
        throw 'An app.worker process uses another Python executable. Identify it manually; no process was stopped.'
    }
}

foreach ($frontOwnerId in @(Get-ListeningIds 5173)) {
    if (-not $targetIds.Contains([int]$frontOwnerId)) {
        throw "Port 5173 belongs to another frontend process ($frontOwnerId). No process was stopped."
    }
}

# 2026-10-24：本次修改原因：提供不停止服务的进程匹配检查，供首次使用前核对。
if ($DryRun) {
    foreach ($targetId in @($targetIds | Sort-Object)) {
        $targetRecord = $processRecords | Where-Object { $_.ProcessId -eq $targetId } | Select-Object -First 1
        Write-Host "Would stop PID $targetId : $($targetRecord.CommandLine)"
    }
    Write-Host 'Dry run only. No process was stopped or started.'
    return
}

foreach ($targetId in @($targetIds)) { Stop-TargetTree ([int]$targetId) }
Start-Sleep -Milliseconds 800
# 2026-10-24：本次修改原因：启动新服务前核对 API、Worker、Vite 的旧 PID 均已退出。
$survivors = @($targetIds | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
if ($survivors.Count -gt 0) { throw "Old project processes still running: $($survivors -join ', ')." }
if (@(Get-ListeningIds 8000).Count -gt 0 -or @(Get-ListeningIds 5173).Count -gt 0) {
    throw 'An old service still holds port 8000 or 5173. New services were not started.'
}

# 2026-10-24：本次修改原因：三个服务后台运行，日志保存在 git 忽略的数据目录，启动后验证 API 和前端确实可用。
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$startedIds = [System.Collections.Generic.List[int]]::new()
try {
    $apiProcess = Start-Process -FilePath $PythonExe -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--reload', '--reload-dir', $backendDir,
                        '--app-dir', $backendDir, '--host', '127.0.0.1', '--port', '8000') `
        -RedirectStandardOutput (Join-Path $logDir "api-$stamp.out.log") `
        -RedirectStandardError (Join-Path $logDir "api-$stamp.err.log")
    $startedIds.Add($apiProcess.Id)
    $apiReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health' -TimeoutSec 2
            $liveSpec = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/openapi.json' -TimeoutSec 2
            if ($health.status -eq 'ok' -and $liveSpec.info.title -eq 'AI4GeoContentOps' -and
                $liveSpec.paths.'/api/v1/library/articles/{sample_id}'.delete) {
                $apiReady = $true
                break
            }
        } catch { }
        if (-not (Get-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $apiReady) { throw "API did not load the current routes. Check api-$stamp.err.log." }

    $workerProcess = Start-Process -FilePath $PythonExe -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru `
        -ArgumentList @('-m', 'app.worker', '--ai4geo-root', $projectRoot) `
        -RedirectStandardOutput (Join-Path $logDir "worker-$stamp.out.log") `
        -RedirectStandardError (Join-Path $logDir "worker-$stamp.err.log")
    $startedIds.Add($workerProcess.Id)
    Start-Sleep -Milliseconds 600
    if (-not (Get-Process -Id $workerProcess.Id -ErrorAction SilentlyContinue)) {
        throw "Worker stopped during startup. Check worker-$stamp.err.log."
    }

    $frontProcess = Start-Process -FilePath $NodeExe -WorkingDirectory $frontendDir -WindowStyle Hidden -PassThru `
        -ArgumentList @($viteScript, '--host', '127.0.0.1', '--port', '5173', '--strictPort') `
        -RedirectStandardOutput (Join-Path $logDir "frontend-$stamp.out.log") `
        -RedirectStandardError (Join-Path $logDir "frontend-$stamp.err.log")
    $startedIds.Add($frontProcess.Id)
    $frontReady = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2
            if ($page.Content -like '*AI4Geo*') { $frontReady = $true; break }
        } catch { }
        if (-not (Get-Process -Id $frontProcess.Id -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $frontReady) { throw "Frontend did not start. Check frontend-$stamp.err.log." }

    Write-Host 'All three services are ready.'
    Write-Host "Frontend: http://127.0.0.1:5173/ (PID $($frontProcess.Id))"
    Write-Host "API docs: http://127.0.0.1:8000/docs (PID $($apiProcess.Id))"
    Write-Host "Worker PID: $($workerProcess.Id)"
    Write-Host "Logs: $logDir"
} catch {
    # Write-Error $_  # 2026-10-24：原输出在 Stop 错误偏好下会提前抛出，导致新进程未清理。
    # 2026-10-24：本次修改原因：先报告错误，再停止本轮启动的服务。
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    $processRecords = Get-ProcessRecords
    $targetIds.Clear()
    $stoppedIds.Clear()
    foreach ($startedId in $startedIds) { Add-TargetTree $startedId }
    foreach ($startedId in $startedIds) { Stop-TargetTree $startedId }
    throw
}
