<#
  PDF Studio - uploads publish\PdfStudio.exe to the PDF Studio Monitor (through the ngrok address) and sends the release
  notes of that version from CHANGELOG.md.  Called by release.bat; can also be run by hand:

      powershell -ExecutionPolicy Bypass -File publish_to_monitor.ps1 [-Force]

  What it does
    1. Reads the version out of the exe (the same File version the monitor reads) and its notes from CHANGELOG.md.
    2. Asks the monitor what it has:
         NEW version             -> uploaded normally
         SAME version, exe changed -> uploaded and OVERWRITES the stored file
         SAME version, same exe  -> nothing is uploaded (release notes are refreshed); -Force uploads anyway
    3. Packs the exe into PdfStudio.zip (deflate, smallest size, about half the size) and sends THAT in 4 MB pieces, so the
       upload is roughly half as big. The monitor's web page shows an "upload in progress" bar while this runs.
       -NoZip sends the plain exe instead (needed only for a monitor that predates zip support).
    4. The monitor verifies the zip's SHA-256, unpacks it, verifies the exe inside (SHA-256, version, product name), stores
       the exe (for older app copies) and the zip (what current app copies download and unpack themselves), then publishes.

  Server address and API key come from (first match wins): -BaseUrl / -ApiKey, the PDFSTUDIO_MONITOR_URL /
  PDFSTUDIO_MONITOR_KEY environment variables, then Services\UsageTracker.cs (DefaultBaseUrl / DefaultApiKey),
  so the ngrok address is only ever written in one place.
#>
param(
    [string]$ExePath   = (Join-Path $PSScriptRoot 'publish\PdfStudio.exe'),
    [string]$Changelog = (Join-Path $PSScriptRoot 'CHANGELOG.md'),
    [string]$BaseUrl   = $env:PDFSTUDIO_MONITOR_URL,
    [string]$ApiKey    = $env:PDFSTUDIO_MONITOR_KEY,
    [switch]$Force,
    [switch]$NoZip
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Fail([string]$msg) { Write-Host ''; Write-Host ('UPLOAD FAILED: ' + $msg) -ForegroundColor Red; exit 1 }
function Mb([double]$n) { return ('{0:N1} MB' -f ($n / 1MB)) }

# ---------- settings ----------
$tracker = Join-Path $PSScriptRoot 'Services\UsageTracker.cs'
$src = ''
if (Test-Path $tracker) { $src = Get-Content -Raw $tracker }
if ([string]::IsNullOrWhiteSpace($BaseUrl) -and $src -match 'DefaultBaseUrl\s*=\s*"([^"]+)"') { $BaseUrl = $Matches[1] }
if ([string]::IsNullOrWhiteSpace($ApiKey)  -and $src -match 'DefaultApiKey\s*=\s*"([^"]+)"')  { $ApiKey  = $Matches[1] }
if ([string]::IsNullOrWhiteSpace($BaseUrl)) { Fail 'No monitor address. Set PDFSTUDIO_MONITOR_URL or DefaultBaseUrl in Services\UsageTracker.cs.' }
if ([string]::IsNullOrWhiteSpace($ApiKey))  { Fail 'No API key. Set PDFSTUDIO_MONITOR_KEY or DefaultApiKey in Services\UsageTracker.cs.' }
$endpoint = $BaseUrl.Trim().TrimEnd('/') + '/upload.php'

if (-not (Test-Path $ExePath)) { Fail ('Exe not found: ' + $ExePath) }
$ExePath = (Resolve-Path $ExePath).Path

# ---------- version ----------
$fv = (Get-Item $ExePath).VersionInfo.FileVersion
if ([string]::IsNullOrWhiteSpace($fv)) { Fail 'The exe has no File version. Set <Version> and <FileVersion> in PdfStudioCS.csproj.' }
$p = $fv.Split('.')
$version = '{0}.{1}.{2}' -f [int]$p[0], [int]$p[1], [int]$p[2]

# ---------- release notes (CHANGELOG.md -> plain text for the update window) ----------
if (-not (Test-Path $Changelog)) { Fail ('CHANGELOG.md not found: ' + $Changelog) }
$log = Get-Content -Raw -Encoding UTF8 $Changelog
$m = [regex]::Match($log, '(?ms)^## \[' + [regex]::Escape($version) + '\][^\r\n]*\r?\n(.*?)(?=^## \[|\z)')
if (-not $m.Success) { Fail ('CHANGELOG.md has no "## [' + $version + ']" section, so there are no release notes to send.') }
$lines = New-Object System.Collections.Generic.List[string]
foreach ($raw in ($m.Groups[1].Value -split '\r?\n')) {
    $l = $raw.TrimEnd()
    $l = [regex]::Replace($l, '\[([^\]]+)\]\([^)]*\)', '$1')   # [text](url) -> text
    $l = $l -replace '\*\*', '' -replace '`', ''
    if ($l -match '^###\s+(.*)$') { if ($lines.Count -gt 0) { $lines.Add('') }; $lines.Add($Matches[1].Trim().ToUpper()); continue }
    if ($l -match '^_(.*)_$')     { $lines.Add($Matches[1].Trim()); continue }
    if ($l.Trim() -eq '')         { continue }
    if ($l -match '^\s*[-*]\s+(.*)$') { $lines.Add([string][char]0x2022 + ' ' + $Matches[1].Trim()); continue }
    $lines.Add($l.Trim())
}
$notes = ($lines -join "`n").Trim()
if ($notes.Length -gt 3900) { $notes = $notes.Substring(0, 3900).TrimEnd() + "`n..." }
if ($notes -eq '') { Fail ('The CHANGELOG.md section for ' + $version + ' is empty.') }

$exeSize = (Get-Item $ExePath).Length
Write-Host ''
Write-Host 'Calculating SHA-256...'
$exeSha = (Get-FileHash -Algorithm SHA256 -Path $ExePath).Hash.ToLower()

# ---------- pack: PdfStudio.exe -> PdfStudio.zip (the signed exe is zipped AFTER signing, so the signature is untouched) ----------
$uploadPath = $ExePath
$package = ''
$tempZip = $null
if (-not $NoZip) {
    $tempZip = Join-Path ([IO.Path]::GetTempPath()) ('PdfStudio-' + $version + '-' + [Guid]::NewGuid().ToString('N') + '.zip')
    Write-Host 'Compressing the exe for upload...'
    $zip = [IO.Compression.ZipFile]::Open($tempZip, [IO.Compression.ZipArchiveMode]::Create)
    # Written by hand (CreateEntry + copy) instead of ZipFileExtensions.CreateEntryFromFile, whose overloads differ between
    # Windows PowerShell 5.1 and PowerShell 7.
    $level = [IO.Compression.CompressionLevel]::Optimal
    if ([Enum]::GetNames([IO.Compression.CompressionLevel]) -contains 'SmallestSize') { $level = [Enum]::Parse([IO.Compression.CompressionLevel], 'SmallestSize') }
    $inStream = $null; $entryStream = $null
    try {
        $entry = $zip.CreateEntry('PdfStudio.exe', $level)
        $entryStream = $entry.Open()
        $inStream = [IO.File]::OpenRead($ExePath)
        $inStream.CopyTo($entryStream, 1MB)
    }
    finally {
        if ($inStream) { $inStream.Dispose() }
        if ($entryStream) { $entryStream.Dispose() }
        $zip.Dispose()
    }
    $uploadPath = $tempZip
    $package = 'zip'
}
$size = (Get-Item $uploadPath).Length
$sha = (Get-FileHash -Algorithm SHA256 -Path $uploadPath).Hash.ToLower()

Write-Host ''
if ($package -eq 'zip') { Write-Host ('Uploading PDF Studio v' + $version + ' (' + (Mb $size) + ' zipped, the exe is ' + (Mb $exeSize) + ' - saves ' + [int](100 - 100 * $size / $exeSize) + '%)') -ForegroundColor Cyan }
else                    { Write-Host ('Uploading PDF Studio v' + $version + ' (' + (Mb $size) + ', not compressed)') -ForegroundColor Cyan }
Write-Host ('Monitor : ' + $endpoint)
Write-Host 'Release notes that will be sent:' -ForegroundColor Cyan
foreach ($ln in ($notes -split "`n")) { Write-Host ('   ' + $ln) -ForegroundColor DarkGray }
Write-Host ''

# ---------- http ----------
$http = New-Object System.Net.Http.HttpClient
$http.Timeout = [TimeSpan]::FromMinutes(10)
$http.DefaultRequestHeaders.Add('X-Api-Key', $ApiKey)
$http.DefaultRequestHeaders.Add('ngrok-skip-browser-warning', '1')    # skips ngrok's free-plan interstitial page

function Invoke-Monitor([string]$query, [System.Net.Http.HttpContent]$content) {
    $resp = $http.PostAsync($endpoint + $query, $content).GetAwaiter().GetResult()
    $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $json = $null
    try { $json = $text | ConvertFrom-Json } catch { }
    if ($null -eq $json) {
        $snippet = $text; if ($snippet.Length -gt 200) { $snippet = $snippet.Substring(0, 200) }
        $json = [pscustomobject]@{ ok = $false; error = ('Unexpected reply (HTTP ' + [int]$resp.StatusCode + '): ' + $snippet) }
    }
    return [pscustomobject]@{ Status = [int]$resp.StatusCode; Json = $json }
}
function JsonBody($obj) {
    return New-Object System.Net.Http.StringContent(($obj | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
}

# ---------- begin: new / replace / identical ----------
try {
    $begin = Invoke-Monitor '?action=begin' (JsonBody @{ version = $version; size = $size; sha256 = $sha; notes = $notes; filename = 'PdfStudio.exe'; force = [bool]$Force; package = $package; exe_size = $exeSize; exe_sha256 = $exeSha })
} catch { if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue }; Fail ('Could not reach the monitor: ' + $_.Exception.Message + ' (is serve.bat and ngrok running?)') }
if (-not $begin.Json.ok) { if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue }; Fail ([string]$begin.Json.error) }
$mode = [string]$begin.Json.mode

# A monitor that predates zip support ignores "package" and would treat the zip as an exe. It does not echo "package" back,
# so cancel that upload and send the plain exe instead (deploy the new monitor to get the smaller upload).
if ($package -eq 'zip' -and $mode -ne 'identical' -and [string]$begin.Json.package -ne 'zip') {
    Write-Host 'This monitor does not support zipped releases yet (it has not been updated) - uploading the plain exe instead.' -ForegroundColor Yellow
    try { [void](Invoke-Monitor ('?action=abort&upload_id=' + [string]$begin.Json.upload_id) (JsonBody @{})) } catch { }
    if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue; $tempZip = $null }
    $uploadPath = $ExePath; $package = ''; $size = $exeSize; $sha = $exeSha
    try { $begin = Invoke-Monitor '?action=begin' (JsonBody @{ version = $version; size = $size; sha256 = $sha; notes = $notes; filename = 'PdfStudio.exe'; force = [bool]$Force }) }
    catch { Fail ('Could not reach the monitor: ' + $_.Exception.Message) }
    if (-not $begin.Json.ok) { Fail ([string]$begin.Json.error) }
    $mode = [string]$begin.Json.mode
}

if ($mode -eq 'identical') {
    if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue }
    Write-Host ('v' + $version + ' is already on the monitor with the SAME file - nothing to upload.') -ForegroundColor Yellow
    if ($begin.Json.notes_updated) { Write-Host 'Release notes were refreshed from CHANGELOG.md.' -ForegroundColor Green }
    Write-Host 'To upload anyway, run publish_to_monitor.ps1 -Force, or bump the version.'
    exit 0
}
if ($mode -eq 'replace') { Write-Host ('v' + $version + ' already exists but the exe is DIFFERENT -> it will be OVERWRITTEN.') -ForegroundColor Yellow }
else                     { Write-Host ('v' + $version + ' is a NEW version -> uploading as a new release.') -ForegroundColor Green }

# ---------- chunks ----------
$id = [string]$begin.Json.upload_id
$chunk = [int]$begin.Json.chunk_size
$fs = [IO.File]::OpenRead($uploadPath)
$buf = New-Object byte[] $chunk
$offset = [long]0
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    while ($offset -lt $size) {
        $fs.Position = $offset
        $n = $fs.Read($buf, 0, $chunk)
        if ($n -le 0) { throw 'Could not read the file to upload.' }
        $sent = $false
        for ($try = 1; $try -le 6 -and -not $sent; $try++) {
            try {
                $body = New-Object System.Net.Http.ByteArrayContent($buf, 0, $n)
                $body.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue('application/octet-stream')
                $r = Invoke-Monitor ('?action=chunk&upload_id=' + $id + '&offset=' + $offset) $body
                if ($r.Json.ok) { $offset = [long]$r.Json.received; $sent = $true }
                elseif ($r.Status -eq 409 -and $null -ne $r.Json.expected_offset) { $offset = [long]$r.Json.expected_offset; $sent = $true }   # resume where the server is
                elseif ($r.Status -ge 400 -and $r.Status -lt 500 -and $r.Status -ne 408 -and $r.Status -ne 429) { throw (New-Object InvalidOperationException ([string]$r.Json.error)) }
                else { throw (New-Object Net.WebException ([string]$r.Json.error)) }
            } catch [InvalidOperationException] {
                throw
            } catch {
                if ($try -ge 6) { throw }
                Write-Host ('  piece failed (' + $_.Exception.Message + '), retrying ' + $try + '/5...') -ForegroundColor Yellow
                Start-Sleep -Seconds ([Math]::Min(10, 2 * $try))
            }
        }
        $pct = [int][Math]::Floor($offset * 100 / $size)
        $rate = if ($clock.Elapsed.TotalSeconds -gt 0) { $offset / $clock.Elapsed.TotalSeconds } else { 0 }
        Write-Progress -Activity ('Uploading PDF Studio v' + $version + ' to the monitor') -Status ('{0}%  ({1} of {2})  {3}/s' -f $pct, (Mb $offset), (Mb $size), (Mb $rate)) -PercentComplete $pct
    }
} catch {
    $fs.Dispose()
    if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue }
    try { [void](Invoke-Monitor ('?action=abort&upload_id=' + $id) (JsonBody @{})) } catch { }
    Write-Progress -Activity 'Uploading' -Completed
    Fail $_.Exception.Message
}
$fs.Dispose()
if ($tempZip) { Remove-Item -LiteralPath $tempZip -ErrorAction SilentlyContinue }
Write-Progress -Activity 'Uploading' -Completed
Write-Host ('Uploaded {0} in {1:N0} s. Verifying and publishing on the monitor...' -f (Mb $size), $clock.Elapsed.TotalSeconds)

# ---------- finish ----------
try { $fin = Invoke-Monitor ('?action=finish&upload_id=' + $id) (JsonBody @{}) } catch { Fail ('Could not finish: ' + $_.Exception.Message) }
if (-not $fin.Json.ok) { Fail ([string]$fin.Json.error) }
Write-Host ''
if ($fin.Json.replaced) { Write-Host ('DONE - v' + $version + ' was OVERWRITTEN on the monitor, with its release notes.') -ForegroundColor Green }
else                    { Write-Host ('DONE - v' + $version + ' was PUBLISHED on the monitor as a new release, with its release notes.') -ForegroundColor Green }
foreach ($w in @($fin.Json.warnings)) { if ($w) { Write-Host ('Note: ' + $w) -ForegroundColor Yellow } }
exit 0
