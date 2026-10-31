<?php
declare(strict_types=1);

/**
 * Universal App Monitor public desktop-client gateway (registry-enabled applications).
 *
 * Deploy this file as /pdfstudio-monitor/public/api/client-gateway.php (or the equivalent
 * /api path handled by your rewrite rules). The shared Monitor API key is loaded only by PHP
 * from a non-public server config file or the server environment. Never copy the key into Electron.
 *
 * Deliberately exposes a strict allowlist: update metadata, raw/ZIP downloads, differential manifests and requested update chunks,
 * access-policy lookup, and validated usage telemetry (open / heartbeat / close sessions and product reviews). It is not a generic proxy.
 */

header('Cache-Control: no-store, private, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function gateway_json_error(int $status, string $message): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $message], JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function gateway_clean_string(mixed $value, int $maxLength): string
{
    if (!is_scalar($value)) return '';
    $text = trim((string)$value);
    $text = preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $text) ?? '';
    return substr($text, 0, $maxLength);
}

/** Free-text cleaner for review fields: keeps line breaks and tabs, strips other control characters, cuts by characters. */
function gateway_clean_text(mixed $value, int $maxLength): string
{
    if (!is_scalar($value)) return '';
    $text = str_replace(["\r\n", "\r"], "\n", (string)$value);
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/u', '', $text) ?? '';
    $text = trim($text);
    return function_exists('mb_substr') ? mb_substr($text, 0, $maxLength) : substr($text, 0, $maxLength);
}

function gateway_valid_version(string $value): bool
{
    return preg_match('/^v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]{1,64})?$/', $value) === 1;
}

function gateway_valid_install_id(string $value): bool
{
    return preg_match('/^[a-f0-9]{16,64}$/i', $value) === 1;
}

/**
 * Small file-backed rate limiter. The key is hashed before being used as a filename; no supplied
 * string can escape the temporary directory. Limits are intentionally generous for shared NATs.
 */
function gateway_rate_limit(string $bucket, int $limit, int $windowSeconds): ?bool
{
    $ip = gateway_clean_string($_SERVER['REMOTE_ADDR'] ?? 'unknown', 64);
    $host = strtolower(gateway_clean_string($_SERVER['HTTP_HOST'] ?? 'monitor', 160));
    $dir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'universal-app-client-gateway';
    if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return null;
    @chmod($dir, 0700);
    $path = $dir . DIRECTORY_SEPARATOR . hash('sha256', $host . '|' . $ip . '|' . $bucket) . '.json';
    $handle = @fopen($path, 'c+');
    if (!$handle) return null;
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        return null;
    }
    rewind($handle);
    $raw = stream_get_contents($handle);
    $data = json_decode(is_string($raw) ? $raw : '', true);
    $now = time();
    if (!is_array($data) || !isset($data['start'], $data['count']) || $now - (int)$data['start'] >= $windowSeconds || $now < (int)$data['start']) {
        $data = ['start' => $now, 'count' => 0];
    }
    $allowed = true;
    if ((int)$data['count'] >= $limit) {
        $allowed = false;
    } else {
        $data['count'] = (int)$data['count'] + 1;
        $encoded = json_encode($data);
        rewind($handle);
        if (!is_string($encoded) || !ftruncate($handle, 0) || fwrite($handle, $encoded) === false || !fflush($handle)) {
            $allowed = null;
        }
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

function gateway_rate_limit_or_reject(string $bucket, int $limit, int $windowSeconds): void
{
    $allowed = gateway_rate_limit($bucket, $limit, $windowSeconds);
    if ($allowed === null) gateway_json_error(503, 'The gateway cannot enforce request throttling right now. Please retry later.');
    if (!$allowed) {
        header('Retry-After: ' . $windowSeconds);
        gateway_json_error(429, 'Too many requests. Please retry later.');
    }
}


/**
 * HTTPS-stream transport for Apache/PHP installations where ext-curl is not enabled.
 * Certificate and hostname validation stay enabled; redirects are never followed, so the
 * server-side API key cannot be sent to a second host. Only selected response headers escape.
 */
function gateway_proxy_with_streams(string $url, array $headers, ?string $requestBody, bool $streamDownload): never
{
    $http = [
        'method' => $requestBody === null ? 'GET' : 'POST',
        'header' => implode("\r\n", $headers),
        'ignore_errors' => true,
        'follow_location' => 0,
        'max_redirects' => 0,
        'timeout' => $streamDownload ? 60 : 25,
        'protocol_version' => 1.1,
    ];
    if ($requestBody !== null) $http['content'] = $requestBody;

    $context = stream_context_create([
        'http' => $http,
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
            'allow_self_signed' => false,
            'SNI_enabled' => true,
        ],
    ]);
    $stream = @fopen($url, 'rb', false, $context);
    $responseLines = isset($http_response_header) && is_array($http_response_header) ? $http_response_header : [];
    $status = 0;
    $responseHeaders = [];
    foreach ($responseLines as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
            $status = (int)$match[1];
            $responseHeaders = [];
            continue;
        }
        if (!str_contains($line, ':')) continue;
        [$name, $value] = array_map('trim', explode(':', $line, 2));
        $name = strtolower($name);
        if (in_array($name, ['content-type', 'content-length', 'content-disposition', 'location', 'retry-after'], true)) {
            $responseHeaders[$name] = $value;
        }
    }
    if (!is_resource($stream)) {
        gateway_json_error(502, 'The Monitor gateway could not reach its HTTPS upstream. Verify the server network and TLS certificate.');
    }
    if ($status < 100 || $status > 599) {
        fclose($stream);
        gateway_json_error(502, 'The Monitor gateway received an invalid upstream HTTP response.');
    }

    if ($streamDownload) {
        @ini_set('zlib.output_compression', '0');
        @set_time_limit(0);
        while (ob_get_level() > 0) @ob_end_flush();
        http_response_code($status);
        foreach ($responseHeaders as $name => $value) {
            if ($name !== 'retry-after' || preg_match('/^\d{1,6}$/', $value) === 1) header($name . ': ' . $value);
        }
        if (!isset($responseHeaders['content-type'])) header('Content-Type: application/octet-stream');
        while (!feof($stream) && !connection_aborted()) {
            $chunk = @fread($stream, 65536);
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($stream);
                if (!empty($meta['timed_out']) || feof($stream)) break;
                // Avoid a hot loop on unusual stream wrappers that return an empty, non-EOF chunk.
                usleep(10000);
                continue;
            }
            echo $chunk;
            flush();
        }
        fclose($stream);
        exit;
    }

    $body = stream_get_contents($stream);
    $meta = stream_get_meta_data($stream);
    fclose($stream);
    if ($body === false || !empty($meta['timed_out'])) {
        gateway_json_error(502, 'The Monitor gateway timed out while reading the HTTPS upstream response.');
    }
    http_response_code($status);
    header('Content-Type: ' . ($responseHeaders['content-type'] ?? 'application/json; charset=utf-8'));
    foreach ($responseHeaders as $name => $value) {
        if ($name === 'location') header('Location: ' . $value);
        elseif ($name === 'retry-after' && preg_match('/^\d{1,6}$/', $value) === 1) header('Retry-After: ' . $value);
    }
    echo $body;
    exit;
}

/**
 * Reuse the Monitor's canonical configuration loader so the gateway and the protected APIs
 * always authenticate against exactly the same server-only key. The loader reads MONITOR_API_KEY
 * from the process environment / project .env and allows private config/config.local.php as fallback.
 */
$monitorRoot = dirname(__DIR__, 2);
require_once $monitorRoot . DIRECTORY_SEPARATOR . 'src' . DIRECTORY_SEPARATOR . 'bootstrap.php';
$apiKey = trim((string) cfg('api_key', ''));

/** Resolve the explicit application identifier. The legacy `app` field remains accepted; `app_id` is canonical. */
function gateway_app_id(mixed $value, bool $allowLegacyPdfDefault = false): string
{
    $appId = strtolower(gateway_clean_string($value ?? '', 32));
    if ($appId === '' && $allowLegacyPdfDefault) $appId = 'pdfstudio';
    if ($appId === '' || !valid_app_id($appId) || !app_uses_client_gateway($appId)) {
        gateway_json_error(400, 'A valid enabled application ID is required for this public desktop gateway resource.');
    }
    return $appId;
}

/** Reject conflicting aliases instead of silently choosing whichever application happens to be first. */
function gateway_request_app_id(array $source, bool $allowLegacyPdfDefault = false): string
{
    $appId = gateway_clean_string($source['app_id'] ?? '', 32);
    $legacyApp = gateway_clean_string($source['app'] ?? '', 32);
    if ($appId !== '' && $legacyApp !== '' && strcasecmp($appId, $legacyApp) !== 0) {
        gateway_json_error(400, 'The app_id and legacy app fields identify different applications.');
    }
    return gateway_app_id($appId !== '' ? $appId : $legacyApp, $allowLegacyPdfDefault);
}

/** Public-safe gateway routing settings; this file contains no API credentials. */
$configFile = $monitorRoot . DIRECTORY_SEPARATOR . 'config' . DIRECTORY_SEPARATOR . 'client-gateway.php';
$config = [];
if (is_file($configFile) && is_readable($configFile)) {
    try {
        $loadedConfig = require $configFile;
        if (is_array($loadedConfig)) $config = $loadedConfig;
    } catch (Throwable $exception) {
        error_log('[PDF Studio gateway] Server configuration could not be loaded.');
    }
}
$basePath = '/' . trim((string) cfg('base_path', '/pdfstudio-monitor'), '/');
$defaultUpstreamBase = 'https://pdfstudio.shares.zrok.io' . ($basePath === '/' ? '' : $basePath) . '/api';
$configuredUpstreamBase = trim((string) (getenv('PDFSTUDIO_MONITOR_API_BASE') ?: ($config['upstream_api_base'] ?? '')));
$upstreamBase = rtrim($configuredUpstreamBase !== '' ? $configuredUpstreamBase : $defaultUpstreamBase, '/');
if (preg_match('/^[A-Za-z0-9_-]{32,128}$/D', $apiKey) !== 1) {
    gateway_json_error(503, 'The server-side MONITOR_API_KEY is missing or invalid. Configure a unique 32-128 character letters/numbers/underscore/hyphen key in the Monitor root .env or private config/config.local.php.');
}
$upstreamParts = parse_url($upstreamBase);
if (!is_array($upstreamParts)
    || strtolower((string)($upstreamParts['scheme'] ?? '')) !== 'https'
    || empty($upstreamParts['host'])
    || isset($upstreamParts['user'])
    || isset($upstreamParts['pass'])
    || !empty($upstreamParts['query'])
    || !empty($upstreamParts['fragment'])) {
    gateway_json_error(503, 'The Monitor gateway upstream must be a valid HTTPS API base URL.');
}

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$resource = gateway_clean_string($_GET['resource'] ?? '', 24);
$upstreamPath = '';
$upstreamQuery = [];
$requestBody = null;
$streamDownload = false;
$rateLimit = ['client', 120, 60];

switch ($resource) {
    case 'update': {
        // Public client gateway for the bridge-first release channel. It deliberately exposes only
        // known update operations; the shared Monitor API key is injected server-side below.
        $action = gateway_clean_string($_GET['action'] ?? 'latest', 16);
        if (!in_array($action, ['latest', 'download', 'manifest', 'delta'], true)) gateway_json_error(400, 'Unsupported update action.');
        $needsPost = $action === 'delta';
        if (($needsPost && $method !== 'POST') || (!$needsPost && !in_array($method, ['GET', 'HEAD'], true))) {
            header('Allow: ' . ($needsPost ? 'POST' : 'GET, HEAD'));
            gateway_json_error(405, $needsPost ? 'Differential update requests require POST.' : 'This update action accepts GET only.');
        }
        $upstreamPath = 'update.php';
        $gatewayAppId = gateway_request_app_id($_GET, true);
        $upstreamQuery = ['action' => $action, 'app_id' => $gatewayAppId, 'app' => $gatewayAppId];
        $version = gateway_clean_string($_GET['version'] ?? '', 96);
        if ($version !== '') {
            if (!gateway_valid_version($version)) gateway_json_error(400, 'Invalid release version.');
            $upstreamQuery['version'] = ltrim($version, 'vV');
        }
        if (in_array($action, ['download', 'manifest', 'delta'], true) && $version === '') {
            gateway_json_error(400, 'A release version is required for this update operation.');
        }
        if ($action === 'latest') {
            $installId = gateway_clean_string($_GET['install_id'] ?? '', 64);
            if ($installId !== '' && !gateway_valid_install_id($installId)) gateway_json_error(400, 'Invalid installation identifier.');
            if ($installId !== '') $upstreamQuery['install_id'] = strtolower($installId);
            $hostname = gateway_clean_string($_GET['hostname'] ?? '', 64);
            if ($hostname !== '') $upstreamQuery['hostname'] = $hostname;
            $localIp = gateway_clean_string($_GET['local_ip'] ?? '', 64);
            if ($localIp !== '' && filter_var($localIp, FILTER_VALIDATE_IP) !== false) $upstreamQuery['local_ip'] = $localIp;
            $rateLimit = ['update-latest-' . $gatewayAppId, 120, 60];
        } elseif ($action === 'download') {
            $format = strtolower(gateway_clean_string($_GET['format'] ?? '', 12));
            if ($format !== '' && $format !== 'zip') gateway_json_error(400, 'Unsupported update package format.');
            if ($format === 'zip') $upstreamQuery['format'] = 'zip';
            $streamDownload = true;
            $rateLimit = ['update-download-' . $gatewayAppId, 30, 3600];
        } elseif ($action === 'manifest') {
            $rateLimit = ['update-manifest-' . $gatewayAppId, 120, 3600];
        } else {
            // Differential requests may name only valid SHA-256 chunk ids. The API revalidates every
            // hash against its release manifest; this gateway also bounds incoming JSON before forwarding.
            $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
            if ($contentLength > 2097152) gateway_json_error(413, 'Differential update request is too large.');
            $rawBody = file_get_contents('php://input', false, null, 0, 2097153);
            if (!is_string($rawBody) || strlen($rawBody) > 2097152) gateway_json_error(413, 'Differential update request is too large.');
            $body = json_decode($rawBody, true);
            if (!is_array($body) || ltrim((string) ($body['version'] ?? ''), 'vV') !== ltrim($version, 'vV')
                || !isset($body['chunks']) || !is_array($body['chunks']) || count($body['chunks']) > 10000) {
                gateway_json_error(400, 'Invalid differential update request.');
            }
            $chunks = [];
            foreach ($body['chunks'] as $hash) {
                if (!is_string($hash) || preg_match('/^[a-f0-9]{64}$/iD', $hash) !== 1) gateway_json_error(400, 'Invalid differential chunk identifier.');
                $chunks[strtolower($hash)] = true;
            }
            $requestBody = json_encode(['version' => ltrim($version, 'vV'), 'chunks' => array_keys($chunks)], JSON_UNESCAPED_SLASHES);
            if (!is_string($requestBody)) gateway_json_error(400, 'Differential request could not be serialized.');
            $streamDownload = true;
            $rateLimit = ['update-delta-' . $gatewayAppId, 60, 3600];
        }
        break;
    }
    case 'access': {
        if ($method !== 'GET') {
            header('Allow: GET');
            gateway_json_error(405, 'This Monitor gateway resource accepts GET only.');
        }
        $installId = gateway_clean_string($_GET['install_id'] ?? '', 64);
        if (!gateway_valid_install_id($installId)) gateway_json_error(400, 'A valid installation identifier is required.');
        $version = gateway_clean_string($_GET['version'] ?? '', 96);
        if ($version !== '' && !gateway_valid_version($version)) gateway_json_error(400, 'Invalid application version.');
        $gatewayAppId = gateway_request_app_id($_GET, true);
        $upstreamPath = 'access.php';
        $upstreamQuery = [
            'app_id' => $gatewayAppId,
            'app' => $gatewayAppId,
            'install_id' => strtolower($installId),
        ];
        if ($version !== '') $upstreamQuery['version'] = ltrim($version, 'vV');
        $hostname = gateway_clean_string($_GET['hostname'] ?? '', 64);
        if ($hostname !== '') $upstreamQuery['hostname'] = $hostname;
        $localIp = gateway_clean_string($_GET['local_ip'] ?? '', 64);
        if ($localIp !== '' && filter_var($localIp, FILTER_VALIDATE_IP) !== false) $upstreamQuery['local_ip'] = $localIp;
        $rateLimit = ['access-policy-' . $gatewayAppId, 600, 60];
        break;
    }
    case 'telemetry': {
        if ($method !== 'POST') {
            header('Allow: POST');
            gateway_json_error(405, 'This Monitor gateway resource accepts POST only.');
        }
        $contentLength = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > 16384) gateway_json_error(413, 'Telemetry payload is too large.');
        $rawBody = file_get_contents('php://input', false, null, 0, 16385);
        if (!is_string($rawBody) || strlen($rawBody) > 16384) gateway_json_error(413, 'Telemetry payload is too large.');
        $body = json_decode($rawBody, true);
        if (!is_array($body)) gateway_json_error(400, 'Telemetry payload must be a JSON object.');
        $event = gateway_clean_string($body['event'] ?? '', 16);
        if (!in_array($event, ['open', 'heartbeat', 'close', 'review'], true)) gateway_json_error(400, 'Unsupported telemetry event.');
        $gatewayAppId = gateway_request_app_id($body, false);
        $installId = gateway_clean_string($body['install_id'] ?? '', 64);
        if (!gateway_valid_install_id($installId)) gateway_json_error(400, 'A valid installation identifier is required.');
        $version = gateway_clean_string($body['version'] ?? '', 96);
        if (!gateway_valid_version($version)) gateway_json_error(400, 'Invalid application version.');
        if ($event === 'review') {
            // Product reviews: rating 1-5, optional name (defaults to the PC name) and feedback text.
            $rating = filter_var($body['rating'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 5]]);
            if ($rating === false) gateway_json_error(400, 'Please choose a rating from 1 to 5 stars.');
            $hostname = gateway_clean_string($body['hostname'] ?? '', 64);
            $os = gateway_clean_string($body['os'] ?? '', 120);
            $localIp = gateway_clean_string($body['local_ip'] ?? '', 64);
            if ($localIp !== '' && filter_var($localIp, FILTER_VALIDATE_IP) === false) $localIp = '';
            $reviewName = gateway_clean_string($body['name'] ?? '', 60);
            if ($reviewName === '') $reviewName = $hostname;
            $requestBody = json_encode([
                'event' => 'review',
                'app_id' => $gatewayAppId,
                'app' => $gatewayAppId,
                'install_id' => strtolower($installId),
                'version' => ltrim($version, 'vV'),
                'os' => $os,
                'hostname' => $hostname,
                'local_ip' => $localIp,
                'rating' => (int)$rating,
                'name' => $reviewName,
                'message' => gateway_clean_text($body['message'] ?? '', 1500),
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
            if (!is_string($requestBody)) gateway_json_error(400, 'Review could not be serialized.');
            gateway_rate_limit_or_reject('review-install-' . $gatewayAppId . '-' . strtolower($installId), 10, 3600);
            $upstreamPath = '';
            $upstreamQuery = [];
            $rateLimit = ['review-' . $gatewayAppId, 60, 60];
            break;
        }
        $sessionId = gateway_clean_string($body['session_id'] ?? '', 64);
        if (preg_match('/^[a-f0-9]{32}$/i', $sessionId) !== 1) gateway_json_error(400, 'Invalid telemetry session identifier.');
        $startedAt = filter_var($body['started_at'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        $seconds = filter_var($body['seconds'] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 31536000]]);
        if ($startedAt === false || $seconds === false) gateway_json_error(400, 'Invalid telemetry timing values.');
        $hostname = gateway_clean_string($body['hostname'] ?? '', 64);
        $os = gateway_clean_string($body['os'] ?? '', 120);
        $localIp = gateway_clean_string($body['local_ip'] ?? '', 64);
        if ($localIp !== '' && filter_var($localIp, FILTER_VALIDATE_IP) === false) $localIp = '';
        $requestBody = json_encode([
            'event' => $event,
            'app_id' => $gatewayAppId,
            'app' => $gatewayAppId,
            'session_id' => strtolower($sessionId),
            'install_id' => strtolower($installId),
            'version' => ltrim($version, 'vV'),
            'os' => $os,
            'hostname' => $hostname,
            'local_ip' => $localIp,
            'started_at' => (int)$startedAt,
            'seconds' => (int)$seconds,
        ], JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
        if (!is_string($requestBody)) gateway_json_error(400, 'Telemetry payload could not be serialized.');
        // Per-install limiting supplements IP limiting and prevents one install identifier from flooding telemetry.
        gateway_rate_limit_or_reject('telemetry-install-' . $gatewayAppId . '-' . strtolower($installId), 10, 60);
        $upstreamPath = '';
        $upstreamQuery = [];
        $rateLimit = ['telemetry-' . $gatewayAppId, 300, 60];
        break;
    }
    default:
        gateway_json_error(404, 'Unknown Monitor gateway resource.');
}

gateway_rate_limit_or_reject($rateLimit[0], (int)$rateLimit[1], (int)$rateLimit[2]);

$upstreamUrl = $upstreamBase . ($upstreamPath !== '' ? '/' . $upstreamPath : '/');
if ($upstreamQuery !== []) $upstreamUrl .= '?' . http_build_query($upstreamQuery, '', '&', PHP_QUERY_RFC3986);

$headers = [
    'X-Api-Key: ' . $apiKey,
    'ngrok-skip-browser-warning: 1',
    'User-Agent: Universal-App-Client-Gateway/1.0',
    'Accept: ' . ($streamDownload ? 'application/octet-stream, application/zip, */*' : 'application/json'),
];
if ($requestBody !== null) $headers[] = 'Content-Type: application/json';

if (!function_exists('curl_init')) {
    if (filter_var((string)ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN) !== true) {
        gateway_json_error(503, 'Enable PHP cURL or allow_url_fopen in the Apache PHP configuration to allow verified HTTPS upstream requests.');
    }
    gateway_proxy_with_streams($upstreamUrl, $headers, $requestBody, $streamDownload);
}

$curl = curl_init($upstreamUrl);
if ($curl === false) gateway_json_error(502, 'The Monitor gateway could not initialize its upstream connection.');

$upstreamStatus = 0;
$forwardHeaders = [];
$streamStarted = false;

curl_setopt_array($curl, [
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_FOLLOWLOCATION => false, // Never forward the server key to a redirect destination.
    CURLOPT_CONNECTTIMEOUT => 8,
    CURLOPT_TIMEOUT => $streamDownload ? 0 : 25,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_HEADERFUNCTION => static function ($handle, string $line) use (&$upstreamStatus, &$forwardHeaders): int {
        $length = strlen($line);
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $match)) {
            $upstreamStatus = (int)$match[1];
            $forwardHeaders = [];
            return $length;
        }
        $trimmed = trim($line);
        if ($trimmed === '' || !str_contains($trimmed, ':')) return $length;
        [$name, $value] = array_map('trim', explode(':', $trimmed, 2));
        $name = strtolower($name);
        if (in_array($name, ['content-type', 'content-length', 'content-disposition', 'location', 'retry-after'], true)) {
            $forwardHeaders[$name] = $value;
        }
        return $length;
    },
]);

if ($requestBody !== null) {
    curl_setopt($curl, CURLOPT_POST, true);
    curl_setopt($curl, CURLOPT_POSTFIELDS, $requestBody);
} else {
    curl_setopt($curl, CURLOPT_HTTPGET, true);
}

if ($streamDownload) {
    // Stream update packages rather than buffering a potentially large EXE in PHP memory.
    @ini_set('zlib.output_compression', '0');
    @set_time_limit(0);
    while (ob_get_level() > 0) @ob_end_flush();
    curl_setopt($curl, CURLOPT_WRITEFUNCTION, static function ($handle, string $chunk) use (&$streamStarted, &$upstreamStatus, &$forwardHeaders): int {
        if (!$streamStarted) {
            http_response_code($upstreamStatus ?: 502);
            foreach ($forwardHeaders as $name => $value) header($name . ': ' . $value);
            if (!isset($forwardHeaders['content-type'])) header('Content-Type: application/octet-stream');
            $streamStarted = true;
        }
        echo $chunk;
        flush();
        return connection_aborted() ? 0 : strlen($chunk);
    });
    $success = curl_exec($curl);
    $curlError = curl_errno($curl);
    $status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);
    if ($success === false && !$streamStarted) {
        gateway_json_error(502, 'The Monitor gateway could not complete the upstream download.');
    }
    if (!$streamStarted) {
        http_response_code($status ?: 502);
        foreach ($forwardHeaders as $name => $value) header($name . ': ' . $value);
        if (!isset($forwardHeaders['content-type'])) header('Content-Type: application/json; charset=utf-8');
    }
    exit;
}

curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
$responseBody = curl_exec($curl);
$curlError = curl_errno($curl);
$status = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$contentType = (string)curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
curl_close($curl);
if ($responseBody === false || $curlError !== 0) gateway_json_error(502, 'The Monitor gateway could not reach its upstream service.');
http_response_code($status ?: 502);
header('Content-Type: ' . ($contentType !== '' ? $contentType : 'application/json; charset=utf-8'));
foreach ($forwardHeaders as $name => $value) {
    if ($name === 'location') header('Location: ' . $value);
    elseif ($name === 'retry-after') header('Retry-After: ' . $value);
}
echo $responseBody;
