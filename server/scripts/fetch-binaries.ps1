# Downloads runtime binaries for the clipper server (Windows).
# Output: server/ffmpeg.exe + server/yt-dlp.exe (both gitignored).
# Idempotent: skips files that already exist unless -Force is passed.
# Usage: npm run fetch:binaries  (from repo root)
#        npm run fetch:binaries -- -Force  (force re-download)

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ServerDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "clipper-binaries"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

# --- yt-dlp (single exe, GitHub release) ---
$YtDlpExe = Join-Path $ServerDir "yt-dlp.exe"
if ((Test-Path -LiteralPath $YtDlpExe) -and (-not $Force)) {
    Write-Host "[binaries] yt-dlp already present, skipping."
} else {
    Write-Host "[binaries] Downloading yt-dlp..."
    Invoke-WebRequest -Uri "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" -OutFile $YtDlpExe
    Write-Host "[binaries] yt-dlp ready."
}

# --- ffmpeg (gyan.dev GnuTLS full build, includes libass for burned captions) ---
# NOTE: use gyan.dev (GnuTLS), NOT BtbN/Schannel builds — Schannel builds hang
# on googlevideo HTTPS range fetching during yt-dlp section downloads.
$FfmpegVersion = "8.1.2"
$FfmpegExe = Join-Path $ServerDir "ffmpeg.exe"
if ((Test-Path -LiteralPath $FfmpegExe) -and (-not $Force)) {
    Write-Host "[binaries] ffmpeg already present, skipping."
} else {
    Write-Host "[binaries] Downloading ffmpeg full build $FfmpegVersion (gyan.dev)..."
    $Zip = Join-Path $TempDir "ffmpeg.zip"
    Invoke-WebRequest -Uri "https://github.com/GyanD/codexffmpeg/releases/download/$FfmpegVersion/ffmpeg-$FfmpegVersion-full_build.zip" -OutFile $Zip
    $Extract = Join-Path $TempDir "ffmpeg-extract"
    if (Test-Path -LiteralPath $Extract) { Remove-Item -Recurse -Force $Extract }
    Expand-Archive -Path $Zip -DestinationPath $Extract -Force
    $Found = Get-ChildItem -Path $Extract -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    if (-not $Found) { throw "ffmpeg.exe not found in extracted archive" }
    Copy-Item -LiteralPath $Found.FullName -Destination $FfmpegExe -Force
    Write-Host "[binaries] ffmpeg ready."
}

Write-Host "[binaries] Done. Verify:"
& $FfmpegExe -hide_banner -version | Select-Object -First 1
& $YtDlpExe --version
