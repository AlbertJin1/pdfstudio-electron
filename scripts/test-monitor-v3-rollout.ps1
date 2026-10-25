param(
    [string]$BridgeVersion = '2.8.15',
    [string]$BaseUrl = $env:PDFSTUDIO_MONITOR_URL,
    [string]$ApiKey = $env:PDFSTUDIO_MONITOR_KEY
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Fail([string]$Message) {
    Write-Host ''
    Write-Host ('SAFE ROLLOUT CHECK FAILED: ' + $Message) -ForegroundColor Red
    exit 1
}

$tracker = Join-Path $PSScriptRoot '..\legacy-windows\Services\UsageTracker.cs'
if (-not (Test-Path -LiteralPath $tracker)) { Fail ('Could not find monitor settings source: ' + $tracker) }
$source = Get-Content -LiteralPath $tracker -Raw
if ([string]::IsNullOrWhiteSpace($BaseUrl) -and $source -match 'DefaultBaseUrl\s*=\s*"([^"]+)"') { $BaseUrl = $Matches[1] }
if ([string]::IsNullOrWhiteSpace($ApiKey) -and $source -match 'DefaultApiKey\s*=\s*"([^"]+)"') { $ApiKey = $Matches[1] }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { Fail 'No monitor URL. Set PDFSTUDIO_MONITOR_URL or DefaultBaseUrl in Services\UsageTracker.cs.' }
if ([string]::IsNullOrWhiteSpace($ApiKey)) { Fail 'No monitor API key. Set PDFSTUDIO_MONITOR_KEY or DefaultApiKey in Services\UsageTracker.cs.' }

# A deliberately old probe client verifies the server selects a safe legacy target, not the global newest release.
$probeVersion = '0.0.0'
$uri = $BaseUrl.Trim().TrimEnd('/') + '/update.php?action=latest&version=' + [Uri]::EscapeDataString($probeVersion)
try {
    $response = Invoke-RestMethod -Method Get -Uri $uri -Headers @{
        'X-Api-Key' = $ApiKey
        'Accept' = 'application/json'
        'ngrok-skip-browser-warning' = '1'
    } -TimeoutSec 20
}
catch {
    Fail ('Could not verify the Monitor rollout API at ' + $BaseUrl + ': ' + $_.Exception.Message)
}

$rollout = $response.rollout
if ($null -eq $rollout) { Fail 'The server did not return rollout metadata. Deploy Universal App Monitor 2.4.8 or newer before publishing Version 3.' }
if ([string]$rollout.policy -ne 'pdfstudio-v3-bridge-gate-v1') { Fail ('Unexpected rollout policy: ' + [string]$rollout.policy + '. Deploy the safe-rollout Monitor build.') }
if ([string]$rollout.bridge_version -ne $BridgeVersion) { Fail ('Monitor bridge version is ' + [string]$rollout.bridge_version + ', but this project expects ' + $BridgeVersion + '.') }
if ($rollout.bridge_release_available -ne $true) { Fail ('PDF Studio ' + $BridgeVersion + ' is not present as a downloadable release on the Monitor. Publish and verify the C# bridge first.') }
if ($null -eq $response.latest -or [string]::IsNullOrWhiteSpace([string]$response.latest.version)) { Fail 'The Monitor has no safe legacy release target for the pre-bridge probe.' }

try {
    $target = [version]([string]$response.latest.version)
    $bridge = [version]$BridgeVersion
    $v3 = [version]([string]$rollout.v3_first_version)
}
catch { Fail 'The Monitor returned invalid target/bridge version metadata.' }
if ($target -lt $bridge -or $target -ge $v3) {
    Fail ('The old-client probe received target ' + $target + '; expected a bridge-compatible target >= ' + $bridge + ' and < ' + $v3 + '.')
}

Write-Host 'SAFE ROLLOUT CHECK PASSED' -ForegroundColor Green
Write-Host ('Monitor policy : ' + $rollout.policy)
Write-Host ('Bridge release : ' + $BridgeVersion + ' (available)')
Write-Host ('Old-client probe target: ' + $target)
Write-Host ('Policy stage   : ' + [string]$rollout.stage)
Write-Host 'This monitor can be used to publish the portable Version 3 artifact.'
exit 0
