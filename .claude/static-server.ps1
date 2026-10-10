# Minimal static file server for previewing Blue Marble Forecast locally (plain
# HTML/CSS/JS, no build step). Runs in the foreground so whatever launches it
# can track/stop it. Serves files from the repository root.
$root = Split-Path -Parent $PSScriptRoot
# Port: $env:PORT when the launcher assigns one (Windows sometimes reserves
# 5510), otherwise 5510.
$port = if ($env:PORT) { [int]$env:PORT } else { 5510 }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
try {
    $listener.Start()
} catch {
    Write-Error "Could not bind to port $port -- it's likely already in use. $($_.Exception.Message)"
    exit 1
}
Write-Output "Serving '$root' at http://127.0.0.1:$port/"

$mimeMap = @{
    ".html" = "text/html"; ".js" = "application/javascript"; ".css" = "text/css"
    ".json" = "application/json"; ".webmanifest" = "application/manifest+json"; ".webp" = "image/webp"; ".svg" = "image/svg+xml"; ".jpg" = "image/jpeg"
    ".jpeg" = "image/jpeg"; ".png" = "image/png"; ".ico" = "image/x-icon"
}

# Dev stand-in for the OPERA relay (tools/opera-relay/worker.js): /opera-relay/<key> forwards to EUMETNET's public radar bucket,
# passing Range requests through. Same allow-list as the real Worker.
Add-Type -AssemblyName System.Net.Http
$http = New-Object System.Net.Http.HttpClient
$operaBucket = "https://s3.waw3-1.cloudferro.com/openradar-24h/"
$operaKey = '^\d{4}/\d{2}/\d{2}/OPERA/COMP/OPERA@\d{8}T\d{4}@0@DBZH\.tiff$'

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    $path = $req.Url.LocalPath

    if ($path.StartsWith("/opera-relay/")) {
        $res.AddHeader("Access-Control-Allow-Origin", "*")
        $key = [Uri]::UnescapeDataString($path.Substring(13))
        if ($key -notmatch $operaKey) { $res.StatusCode = 404; $res.Close(); continue }
        try {
            $msg = New-Object System.Net.Http.HttpRequestMessage ([System.Net.Http.HttpMethod]::new($req.HttpMethod)), ($operaBucket + $key)
            if ($req.Headers["Range"]) { [void]$msg.Headers.TryAddWithoutValidation("Range", $req.Headers["Range"]) }
            $up = $http.SendAsync($msg).Result
            $res.StatusCode = [int]$up.StatusCode
            $res.AddHeader("Accept-Ranges", "bytes")
            if ($up.Content.Headers.ContentRange) { $res.AddHeader("Content-Range", $up.Content.Headers.ContentRange.ToString()) }
            $res.ContentType = "image/tiff"
            $body = $up.Content.ReadAsByteArrayAsync().Result
            if ($req.HttpMethod -eq "HEAD") { $res.ContentLength64 = 0 }
            else { $res.ContentLength64 = $body.Length; $res.OutputStream.Write($body, 0, $body.Length) }
        } catch { $res.StatusCode = 502 }
        $res.OutputStream.Close()
        continue
    }

    if ($path -eq "/") { $path = "/index.html" }
    $rel = $path.TrimStart("/") -replace "/", "\"
    $filePath = Join-Path $root $rel

    # Folders with their own index.html (e.g. /weather/) are standalone
    # sub-sites, like on GitHub Pages: redirect /weather -> /weather/ so
    # relative asset paths resolve, then serve that folder's index.html.
    if ((Test-Path $filePath -PathType Container) -and (Test-Path (Join-Path $filePath "index.html"))) {
        if (-not $path.EndsWith("/")) {
            $res.Redirect($path + "/")
            $res.Close()
            continue
        }
        $filePath = Join-Path $filePath "index.html"
    }

    # Unknown paths serve index.html.
    if (-not (Test-Path $filePath) -or (Get-Item $filePath).PSIsContainer) {
        $filePath = Join-Path $root "index.html"
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $ext = [System.IO.Path]::GetExtension($filePath)
        $res.ContentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { "application/octet-stream" }
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $res.StatusCode = 404
    }
    $res.OutputStream.Close()
}
