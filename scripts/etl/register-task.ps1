# ============================================================
# register-task.ps1
# 세정-CRM ETL 작업을 Windows 작업 스케줄러에 등록 (매시간 자동 동기화).
# ------------------------------------------------------------
# sejung-etl.xml 을 읽어 그 안의 경로(C:\sejung-crm)를 *현재 저장소 위치*로
# 치환한 뒤 등록한다. $PSScriptRoot(= scripts\etl) 기준으로 저장소 루트를
# 자동 계산하므로, 어느 경로에 clone 했든 (예: C:\dev\sejung-crm) 그대로 동작.
#
# 사용:  powershell -ExecutionPolicy Bypass -File scripts\etl\register-task.ps1
# ============================================================
$ErrorActionPreference = 'Stop'

# scripts\etl -> 저장소 루트 (두 단계 위)
$repo    = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$xmlPath = Join-Path $PSScriptRoot 'sejung-etl.xml'

# XML 안의 자리표시 경로 C:\sejung-crm 를 실제 저장소 경로로 치환
$xml = (Get-Content $xmlPath -Raw) -replace 'C:\\sejung-crm', $repo

Register-ScheduledTask -Xml $xml -TaskName 'CRM-ETL-Hourly' -TaskPath '\Sejung\' -Force | Out-Null

Write-Host "[OK] 등록 완료. 저장소 경로 = $repo"
Get-ScheduledTask -TaskName 'CRM-ETL-Hourly' -TaskPath '\Sejung\' |
  Select-Object TaskName, TaskPath, State |
  Format-List
