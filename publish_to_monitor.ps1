[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExePath,
    [Parameter(Mandatory = $true)][string]$Changelog,
    [Parameter(Mandatory = $true)][string]$MonitorUrl,
    [string]$FallbackMonitorUrl = '',
    [switch]$Force,
    [switch]$NoZip,
    # Resolve this after parameter binding: on some Windows PowerShell invocation paths,
    # $PSScriptRoot is empty while default parameter expressions are evaluated.
    [string]$ApiKeyFile = ''
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Establish a reliable script directory without evaluating Join-Path in a parameter default.
$script:PublishScriptRoot = [string]$PSScriptRoot
if ([string]::IsNullOrWhiteSpace($script:PublishScriptRoot)) {
    $pathHint = [string]$PSCommandPath
    if ([string]::IsNullOrWhiteSpace($pathHint)) { $pathHint = [string]$MyInvocation.MyCommand.Path }
    if (-not [string]::IsNullOrWhiteSpace($pathHint)) {
        try { $script:PublishScriptRoot = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($pathHint)) } catch { }
    }
}
if ([string]::IsNullOrWhiteSpace($script:PublishScriptRoot)) { $script:PublishScriptRoot = (Get-Location).Path }
$script:PublishScriptRoot = [System.IO.Path]::GetFullPath($script:PublishScriptRoot)
if ([string]::IsNullOrWhiteSpace($ApiKeyFile)) {
    $ApiKeyFile = [System.IO.Path]::Combine($script:PublishScriptRoot, 'monitor-key.txt')
} elseif (-not [System.IO.Path]::IsPathRooted($ApiKeyFile)) {
    $ApiKeyFile = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($script:PublishScriptRoot, $ApiKeyFile))
}
$script:ApiUrls = @()
$script:ApiKey = ''
$script:LastApiUrl = ''
$script:ActiveApiUrl = $null
$script:TempPackage = $null
$script:UploadId = $null

function Get-HttpStatus([System.Management.Automation.ErrorRecord]$Record) {
    try {
        $response = $Record.Exception.Response
        if ($null -ne $response -and $null -ne $response.StatusCode) { return [int]$response.StatusCode }
    } catch { }
    return 0
}

function Get-HttpErrorBody([System.Management.Automation.ErrorRecord]$Record) {
    try {
        $response = $Record.Exception.Response
        if ($null -eq $response) { return '' }
        if ($response -is [System.Net.Http.HttpResponseMessage]) { return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() }
        $stream = $response.GetResponseStream()
        if ($null -eq $stream) { return '' }
        $reader = New-Object System.IO.StreamReader($stream)
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } catch { return '' }
}

function Get-ApiKey {
    $key = [string]$env:PDFSTUDIO_MONITOR_KEY
    if (-not [string]::IsNullOrWhiteSpace($key)) { return $key.Trim() }
    if (Test-Path -LiteralPath $ApiKeyFile -PathType Leaf) {
        $key = [System.IO.File]::ReadAllText($ApiKeyFile).Trim()
        if (-not [string]::IsNullOrWhiteSpace($key)) { return $key }
    }
    Write-Host 'A Monitor publishing API key is required. It will not be written into the application or release package.' -ForegroundColor Yellow
    $secure = Read-Host 'Monitor API key' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ([string]::IsNullOrWhiteSpace($key)) { throw 'No Monitor API key was provided.' }
    return $key.Trim()
}

function Get-ReleaseNotes([string]$Path, [string]$Version) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Changelog not found: $Path" }
    $text = [System.IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
    $escapedVersion = [regex]::Escape($Version)
    $headingPattern = '(?im)^(#{1,6})\s+(?:\[\s*)?v?' + $escapedVersion + '(?:\s*\])?(?=\s|$|[-:-]).*$'
    $heading = [regex]::Match($text, $headingPattern)
    if (-not $heading.Success) { throw "CHANGELOG.md has no section heading for EXE version $Version. Add a heading such as '## $Version' before publishing." }
    $level = $heading.Groups[1].Value.Length
    $start = $heading.Index + $heading.Length
    $remainder = $text.Substring($start)
    $nextHeading = [regex]::Match($remainder, '(?m)^#{1,' + $level + '}\s+.*$')
    if ($nextHeading.Success) { $section = $remainder.Substring(0, $nextHeading.Index) } else { $section = $remainder }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($raw in ($section -split '\r?\n')) {
        $line = [regex]::Replace($raw.TrimEnd(), '\[([^\]]+)\]\([^)]*\)', '$1')
        $line = $line -replace '\*\*', '' -replace '`', ''
        if ($line -match '^\s*#{2,6}\s+(.*)$') {
            if ($lines.Count -gt 0) { $lines.Add('') }
            $lines.Add($Matches[1].Trim().ToUpperInvariant())
            continue
        }
        if ($line -match '^\s*[-*]\s+(.*)$') { $lines.Add([string][char]0x2022 + ' ' + $Matches[1].Trim()); continue }
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $lines.Add($line.Trim())
    }
    $notes = ($lines -join "`n").Trim()
    if ([string]::IsNullOrWhiteSpace($notes)) { throw "The CHANGELOG section for $Version is empty." }
    if ($notes.Length -gt 3900) { $notes = $notes.Substring(0, 3900).TrimEnd() + "`n..." }
    return $notes
}

function New-ExeZip([string]$SourceExe, [string]$Version) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $path = Join-Path ([IO.Path]::GetTempPath()) ('PdfStudio-' + $Version + '-' + [Guid]::NewGuid().ToString('N') + '.zip')
    $archive = $null; $inputStream = $null; $entryStream = $null
    try {
        $archive = [IO.Compression.ZipFile]::Open($path, [IO.Compression.ZipArchiveMode]::Create)
        $level = [IO.Compression.CompressionLevel]::Optimal
        if ([Enum]::GetNames([IO.Compression.CompressionLevel]) -contains 'SmallestSize') { $level = [Enum]::Parse([IO.Compression.CompressionLevel], 'SmallestSize') }
        $entry = $archive.CreateEntry('PdfStudio.exe', $level)
        $entryStream = $entry.Open()
        $inputStream = [IO.File]::OpenRead($SourceExe)
        $inputStream.CopyTo($entryStream, 1MB)
    }
    catch {
        $zipError = $_.Exception.Message
    }
    finally {
        if ($inputStream) { $inputStream.Dispose() }
        if ($entryStream) { $entryStream.Dispose() }
        if ($archive) { $archive.Dispose() }
    }
    if ($zipError) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
        throw "Could not create the compressed release package: $zipError"
    }
    return $path
}

function Remove-TempPackage {
    if (-not [string]::IsNullOrWhiteSpace([string]$script:TempPackage) -and (Test-Path -LiteralPath $script:TempPackage)) {
        Remove-Item -LiteralPath $script:TempPackage -Force -ErrorAction SilentlyContinue
    }
    $script:TempPackage = $null
}

function Invoke-MonitorApi([string]$Query, [string]$Method = 'Post', [object]$Body = '', [string]$ContentType = 'application/json; charset=utf-8') {
    $headers = @{
        'X-Api-Key' = $script:ApiKey
        'Accept' = 'application/json'
        'ngrok-skip-browser-warning' = '1'
    }
    $lastError = $null
    # Probe alternate routes only for the first request. Once begin succeeds, pin every chunk/finish/abort request
    # to that exact API route so upload IDs and raw-vs-base64 chunk encoding cannot cross endpoint variants.
    if (-not [string]::IsNullOrWhiteSpace([string]$script:ActiveApiUrl)) { $candidates = @([string]$script:ActiveApiUrl) }
    else { $candidates = @($script:ApiUrls) }
    for ($i = 0; $i -lt $candidates.Count; $i++) {
        $uri = $candidates[$i] + '?' + $Query
        $script:LastApiUrl = $candidates[$i]
        try {
            if ($Method -eq 'Get') {
                $result = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 180 -ErrorAction Stop
            } else {
                $result = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType $ContentType -Body $Body -TimeoutSec 180 -ErrorAction Stop
            }
            # A tunnel/browser interstitial can return HTML with HTTP 200. Never treat it as an API success.
            if ($result -is [string]) {
                try { $result = $result | ConvertFrom-Json -ErrorAction Stop }
                catch {
                    if ($i -lt ($candidates.Count - 1)) { continue }
                    throw 'Monitor endpoint returned non-JSON content instead of an upload API response.'
                }
            }
            $propertyNames = @($result.PSObject.Properties | ForEach-Object { $_.Name })
            if ($propertyNames -notcontains 'ok') {
                if ($i -lt ($candidates.Count - 1)) { continue }
                throw 'Monitor endpoint did not return the expected upload API JSON response.'
            }
            if ([string]::IsNullOrWhiteSpace([string]$script:ActiveApiUrl)) { $script:ActiveApiUrl = $candidates[$i] }
            return $result
        }
        catch {
            $lastError = $_
            $status = Get-HttpStatus $_
            # Retry an alternate route/base only while no upload session has been accepted.
            # 0 means a connection/timeout failure; 401 also permits trying another configured Monitor
            # deployment when its API-key configuration differs. Other statuses cover tunnel/WAF
            # failures or a temporarily unavailable primary Monitor. Never switch
            # after begin succeeds because upload IDs are scoped to the accepting endpoint.
            $retryableRouteStatuses = @([int]0, [int]401, [int]403, [int]404, [int]408, [int]429)
            if ($status -ge 500 -or ($i -lt ($candidates.Count - 1) -and $retryableRouteStatuses -contains $status)) {
                if ($i -lt ($candidates.Count - 1)) { continue }
            }
            throw
        }
    }
    if ($null -ne $lastError) { throw $lastError }
    throw 'Monitor API request failed for an unknown reason.'
}

function Test-MonitorTcpEndpoint([Uri]$Uri, [int]$TimeoutMs = 1800) {
    $client = $null; $async = $null
    try {
        $port = if ($Uri.IsDefaultPort) { if ($Uri.Scheme -eq 'https') { 443 } else { 80 } } else { $Uri.Port }
        $client = New-Object System.Net.Sockets.TcpClient
        $async = $client.BeginConnect($Uri.Host, $port, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($TimeoutMs, $false)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false }
    finally {
        if ($async -and $async.AsyncWaitHandle) { $async.AsyncWaitHandle.Close() }
        if ($client) { $client.Close() }
    }
}

function Get-MonitorPageFromApiUrl([string]$ApiUrl) {
    $pageBase = $ApiUrl -replace '/(?:public/)?api/upload\.php$', '' -replace '/upload\.php$', ''
    return $pageBase.TrimEnd('/') + '/releases.php'
}

function Assert-ApiSuccess($Response, [string]$Context) {
    if ($null -eq $Response) { throw "$Context returned an empty response." }
    $propertyNames = @($Response.PSObject.Properties | ForEach-Object { $_.Name })
    if ($propertyNames -notcontains 'ok') { throw "$Context did not return the expected Monitor API response." }
    if ($Response.ok -ne $true) {
        $message = [string]$Response.error
        if ([string]::IsNullOrWhiteSpace($message)) { $message = 'Monitor returned ok=false.' }
        throw "$Context failed: $message"
    }
}

function Abort-Upload([string]$Id) {
    if ([string]::IsNullOrWhiteSpace($Id)) { return }
    try { [void](Invoke-MonitorApi -Query ('action=abort&upload_id=' + [Uri]::EscapeDataString($Id)) -Method 'Post' -Body '{}') } catch { }
}

function New-BeginBody([string]$Version, [long]$Size, [string]$Sha256, [string]$Notes, [bool]$UseZip, [long]$ExeSize, [string]$ExeSha256, [bool]$ForceRelease) {
    $data = @{
        app = 'pdfstudio'
        version = $Version
        size = $Size
        sha256 = $Sha256
        notes = $Notes
        filename = 'PdfStudio.exe'
        force = $ForceRelease
    }
    if ($UseZip) {
        $data.package = 'zip'
        $data.exe_size = $ExeSize
        $data.exe_sha256 = $ExeSha256
    }
    return ($data | ConvertTo-Json -Depth 6 -Compress)
}

try {
    if (-not (Test-Path -LiteralPath $ExePath -PathType Leaf)) { throw "Portable EXE not found: $ExePath" }
    if (-not (Test-Path -LiteralPath $Changelog -PathType Leaf)) { throw "Changelog not found: $Changelog" }
    $base = $MonitorUrl.Trim().TrimEnd('/')
    $baseUri = $null
    if (-not [Uri]::TryCreate($base, [UriKind]::Absolute, [ref]$baseUri) -or $baseUri.Scheme -notin @('http', 'https')) {
        throw 'MonitorUrl must be an absolute HTTP or HTTPS URL to the Monitor root, not releases.php.'
    }
    if ($baseUri.Query -or $baseUri.Fragment) { throw 'MonitorUrl cannot contain a query string or fragment.' }
    if ($baseUri.Scheme -eq 'http') {
        Write-Host 'WARNING: this Monitor uses HTTP. The API key is sent across the network; use this only on a trusted private LAN.' -ForegroundColor Yellow
    }

    $baseUrls = New-Object System.Collections.Generic.List[string]
    [void]$baseUrls.Add($base)
    $fallbackBase = $FallbackMonitorUrl.Trim().TrimEnd('/')
    if (-not [string]::IsNullOrWhiteSpace($fallbackBase)) {
        $fallbackUri = $null
        if (-not [Uri]::TryCreate($fallbackBase, [UriKind]::Absolute, [ref]$fallbackUri) -or $fallbackUri.Scheme -notin @('http', 'https')) {
            throw 'FallbackMonitorUrl must be an absolute HTTP or HTTPS URL to the Monitor root.'
        }
        if ($fallbackUri.Query -or $fallbackUri.Fragment) { throw 'FallbackMonitorUrl cannot contain a query string or fragment.' }
        if ($fallbackBase -ne $base) {
            # Avoid making users wait through long HTTP timeouts when the primary LAN server is offline.
            # Once an upload session starts, all subsequent operations remain pinned to that exact URL.
            if (-not (Test-MonitorTcpEndpoint $baseUri)) {
                Write-Host 'Primary Monitor is not reachable; trying the configured fallback first.' -ForegroundColor Yellow
                [void]$baseUrls.Insert(0, $fallbackBase)
            } else {
                [void]$baseUrls.Add($fallbackBase)
            }
        }
    }

    $file = Get-Item -LiteralPath $ExePath
    $info = $file.VersionInfo
    if ($info.ProductName -ne 'PDF Studio') { throw "ProductName must be 'PDF Studio'; found '$($info.ProductName)' ." }
    $versionMatch = [regex]::Match([string]$info.FileVersion, '^\s*v?(\d+\.\d+\.\d+)(?:\.\d+)?')
    if (-not $versionMatch.Success) { throw "Could not read a valid 3-part version from EXE FileVersion '$($info.FileVersion)' ." }
    $version = $versionMatch.Groups[1].Value
    $notes = Get-ReleaseNotes -Path $Changelog -Version $version
    $exeHash = (Get-FileHash -LiteralPath $ExePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $exeSize = [long]$file.Length
    # Prefer the current Monitor API, then the public/API subdirectory used by some hosted configurations,
    # then the legacy PDF Studio endpoint. The uploader validates JSON and never mistakes a web page for success.
    $apiCandidates = New-Object System.Collections.Generic.List[string]
    foreach ($apiBase in $baseUrls) {
        [void]$apiCandidates.Add($apiBase + '/api/upload.php')
        [void]$apiCandidates.Add($apiBase + '/public/api/upload.php')
        [void]$apiCandidates.Add($apiBase + '/upload.php')
    }
    $script:ApiUrls = @($apiCandidates | Select-Object -Unique)
    $script:ApiKey = Get-ApiKey

    $uploadPath = $ExePath
    $uploadSize = $exeSize
    $uploadSha = $exeHash
    $useZip = $false
    if (-not $NoZip) {
        Write-Host 'Compressing the portable EXE for upload...' -ForegroundColor Cyan
        $script:TempPackage = New-ExeZip -SourceExe $ExePath -Version $version
        $zipSize = [long](Get-Item -LiteralPath $script:TempPackage).Length
        if ($zipSize -lt $exeSize) {
            $uploadPath = $script:TempPackage
            $uploadSize = $zipSize
            $uploadSha = (Get-FileHash -LiteralPath $uploadPath -Algorithm SHA256).Hash.ToLowerInvariant()
            $useZip = $true
        } else {
            Write-Host 'ZIP is not smaller than the EXE; using the raw EXE for this release.' -ForegroundColor Yellow
            Remove-TempPackage
        }
    }

    Write-Host ''
    Write-Host "PDF Studio V3 release : $version" -ForegroundColor Cyan
    Write-Host ('EXE size             : {0:N1} MB' -f ($exeSize / 1MB))
    $uploadKindLabel = if ($useZip) { ' (compressed ZIP)' } else { ' (raw EXE)' }
    Write-Host ('Upload size          : {0:N1} MB{1}' -f ($uploadSize / 1MB), $uploadKindLabel)
    if ($useZip) { Write-Host ('Upload reduction     : {0:N1}%' -f (100 * (1 - ($uploadSize / [double]$exeSize)))) }
    Write-Host "Monitor              : $base"
    Write-Host "SHA-256              : $uploadSha"
    Write-Host 'Starting resumable upload...' -ForegroundColor Cyan

    $beginBody = New-BeginBody -Version $version -Size $uploadSize -Sha256 $uploadSha -Notes $notes -UseZip $useZip -ExeSize $exeSize -ExeSha256 $exeHash -ForceRelease ([bool]$Force)
    $begin = $null
    try {
        $begin = Invoke-MonitorApi -Query 'action=begin' -Method 'Post' -Body $beginBody
    }
    catch {
        $status = Get-HttpStatus $_
        $bodyText = Get-HttpErrorBody $_
        if ($useZip -and $status -eq 400 -and $bodyText -match '(?i)(zip|package)') {
            Write-Host 'This Monitor rejected the ZIP package format. Retrying with the raw EXE.' -ForegroundColor Yellow
            Remove-TempPackage
            $uploadPath = $ExePath; $uploadSize = $exeSize; $uploadSha = $exeHash; $useZip = $false
            $beginBody = New-BeginBody -Version $version -Size $uploadSize -Sha256 $uploadSha -Notes $notes -UseZip $false -ExeSize $exeSize -ExeSha256 $exeHash -ForceRelease ([bool]$Force)
            $begin = Invoke-MonitorApi -Query 'action=begin' -Method 'Post' -Body $beginBody
        } else { throw }
    }
    if ($useZip -and $null -ne $begin -and $begin.ok -eq $false -and [string]$begin.error -match '(?i)(zip|package)') {
        Write-Host 'This Monitor rejected the ZIP package format. Retrying with the raw EXE.' -ForegroundColor Yellow
        Remove-TempPackage
        $uploadPath = $ExePath; $uploadSize = $exeSize; $uploadSha = $exeHash; $useZip = $false
        $beginBody = New-BeginBody -Version $version -Size $uploadSize -Sha256 $uploadSha -Notes $notes -UseZip $false -ExeSize $exeSize -ExeSha256 $exeHash -ForceRelease ([bool]$Force)
        $begin = Invoke-MonitorApi -Query 'action=begin' -Method 'Post' -Body $beginBody
    }
    Assert-ApiSuccess $begin 'Start upload'
    if ([string]$begin.mode -eq 'identical') {
        Remove-TempPackage
        Write-Host "PDF Studio $version is already published with the identical executable. No binary upload was needed." -ForegroundColor Green
        if ($begin.notes_updated -eq $true) { Write-Host 'Release notes were refreshed.' }
        exit 0
    }
    if ([string]::IsNullOrWhiteSpace([string]$begin.upload_id)) { throw 'Monitor did not return an upload ID for a non-identical release.' }

    # A Monitor predating ZIP packages might accept the request but return no package=zip capability marker.
    # Abort that provisional upload before sending the actual EXE, so a ZIP can never be published as PdfStudio.exe.
    if ($useZip -and [string]$begin.package -ne 'zip') {
        Write-Host 'This Monitor did not confirm ZIP package support. Restarting the upload with the raw EXE.' -ForegroundColor Yellow
        Abort-Upload -Id ([string]$begin.upload_id)
        Remove-TempPackage
        $uploadPath = $ExePath
        $uploadSize = $exeSize
        $uploadSha = $exeHash
        $useZip = $false
        $beginBody = New-BeginBody -Version $version -Size $uploadSize -Sha256 $uploadSha -Notes $notes -UseZip $false -ExeSize $exeSize -ExeSha256 $exeHash -ForceRelease ([bool]$Force)
        $begin = Invoke-MonitorApi -Query 'action=begin' -Method 'Post' -Body $beginBody
        Assert-ApiSuccess $begin 'Start raw EXE upload'
        if ([string]$begin.mode -eq 'identical') {
            Write-Host "PDF Studio $version is already published with the identical executable. No binary upload was needed." -ForegroundColor Green
            if ($begin.notes_updated -eq $true) { Write-Host 'Release notes were refreshed.' }
            exit 0
        }
        if ([string]::IsNullOrWhiteSpace([string]$begin.upload_id)) { throw 'Monitor did not return an upload ID for the raw EXE upload.' }
    }

    $script:UploadId = [string]$begin.upload_id
    if ([string]::IsNullOrWhiteSpace($script:UploadId)) { throw 'Monitor returned success but did not provide an upload ID.' }
    $chunkSize = 4 * 1024 * 1024
    if ($begin.chunk_size -and [int]$begin.chunk_size -ge 65536 -and [int]$begin.chunk_size -le (16 * 1024 * 1024)) { $chunkSize = [int]$begin.chunk_size }
    $offset = [long]0
    $stream = [System.IO.File]::Open($uploadPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        while ($offset -lt $uploadSize) {
            $stream.Position = $offset
            $want = [int][Math]::Min([long]$chunkSize, ($uploadSize - $offset))
            $buffer = New-Object byte[] $want
            $read = $stream.Read($buffer, 0, $want)
            if ($read -le 0) { throw "Could not read upload data at byte $offset." }
            if ($read -ne $want) {
                $trimmed = New-Object byte[] $read
                [Array]::Copy($buffer, $trimmed, $read)
                $buffer = $trimmed
            }
            $nextOffset = $offset + $read
            $retry = 0
            $chunkAccepted = $false
            while (-not $chunkAccepted -and $retry -lt 5) {
                try {
                    # Send a raw EXE as raw binary. Base64 is only needed for ZIP packages that may be
                    # blocked by WAF/tunnel content inspection. Sending a 145 MB EXE as base64 adds
                    # 33% transport overhead and creates an extra server-side decode path at finalization.
                    $legacyEndpoint = $script:LastApiUrl -notmatch '/(?:public/)?api/upload\.php$'
                    if ($legacyEndpoint -or -not $useZip) {
                        $query = 'action=chunk&upload_id=' + [Uri]::EscapeDataString($script:UploadId) + '&offset=' + $offset
                        $body = $buffer
                        $contentType = 'application/octet-stream'
                    } else {
                        $query = 'action=chunk&upload_id=' + [Uri]::EscapeDataString($script:UploadId) + '&offset=' + $offset + '&enc=base64'
                        $body = [Convert]::ToBase64String($buffer)
                        $contentType = 'text/plain; charset=utf-8'
                    }
                    $chunkResult = Invoke-MonitorApi -Query $query -Method 'Post' -Body $body -ContentType $contentType
                    Assert-ApiSuccess $chunkResult 'Upload chunk'
                    $received = [long]$chunkResult.received
                    if ($received -ne $nextOffset) { throw "Monitor acknowledged byte $received but expected $nextOffset." }
                    $offset = $received
                    $chunkAccepted = $true
                }
                catch {
                    $status = Get-HttpStatus $_
                    $bodyText = Get-HttpErrorBody $_
                    $errorJson = $null
                    if (-not [string]::IsNullOrWhiteSpace($bodyText)) { try { $errorJson = $bodyText | ConvertFrom-Json -ErrorAction Stop } catch { } }
                    if ($status -eq 409 -and $null -ne $errorJson -and $null -ne $errorJson.expected_offset) {
                        $expected = [long]$errorJson.expected_offset
                        if ($expected -lt 0 -or $expected -gt $uploadSize) { throw "Monitor returned invalid resume offset $expected." }
                        if ($expected -eq $nextOffset) {
                            $offset = $expected # server committed the chunk but the response was lost
                            $chunkAccepted = $true
                        } elseif ($expected -ne $offset) {
                            $offset = $expected # resume at the exact offset reported by the server
                            $chunkAccepted = $true
                        } else {
                            $retry++
                            if ($retry -lt 5) { Start-Sleep -Seconds ([Math]::Min(2 * $retry, 8)) }
                        }
                    } else {
                        $retry++
                        if ($retry -lt 5) {
                            Write-Host "Chunk at byte $offset failed (attempt $retry/5); retrying... $($_.Exception.Message)" -ForegroundColor Yellow
                            Start-Sleep -Seconds ([Math]::Min(2 * $retry, 8))
                        } else {
                            throw "Chunk upload failed at byte $offset after 5 attempts. $($_.Exception.Message)"
                        }
                    }
                }
            }
            if (-not $chunkAccepted) { throw "Chunk upload did not complete at byte $offset." }
            Write-Progress -Activity "Publishing PDF Studio $version" -Status ('Uploaded {0:N1} / {1:N1} MB' -f ($offset / 1MB), ($uploadSize / 1MB)) -PercentComplete ([int][Math]::Min(100, (($offset / [double]$uploadSize) * 100)))
        }
    }
    finally { $stream.Dispose(); Write-Progress -Activity "Publishing PDF Studio $version" -Completed }

    Write-Host ('Uploaded {0:N1} MB. Monitor is verifying and publishing...' -f ($uploadSize / 1MB))
    try {
        $finish = Invoke-MonitorApi -Query ('action=finish&upload_id=' + [Uri]::EscapeDataString($script:UploadId)) -Method 'Post' -Body '{}'
    } catch {
        $status = Get-HttpStatus $_
        $bodyText = Get-HttpErrorBody $_
        $errorMessage = ''
        if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
            try {
                $errorObject = $bodyText | ConvertFrom-Json -ErrorAction Stop
                $errorMessage = [string]$errorObject.error
            } catch { $errorMessage = $bodyText.Trim() }
        }
        if (-not [string]::IsNullOrWhiteSpace($errorMessage)) {
            throw ("Finalize release failed (HTTP {0}): {1}" -f $status, $errorMessage)
        }
        if ($status -gt 0) { throw ("Finalize release failed (HTTP {0}); Monitor did not return a readable error body. Original error: {1}" -f $status, $_.Exception.Message) }
        throw
    }
    Assert-ApiSuccess $finish 'Finalize release'
    Remove-TempPackage
    $script:UploadId = $null
    Write-Host ''
    Write-Host ([string]$finish.message) -ForegroundColor Green
    Write-Host "Published version: $($finish.version)"
    Write-Host ("Monitor release page: " + (Get-MonitorPageFromApiUrl $script:LastApiUrl))
    exit 0
}
catch {
    if ($script:UploadId) { Abort-Upload -Id $script:UploadId }
    Remove-TempPackage
    Write-Host ''
    Write-Host ('RELEASE UPLOAD FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
