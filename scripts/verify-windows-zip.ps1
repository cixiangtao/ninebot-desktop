param(
  [Parameter(Mandatory = $true)][string]$ArchivePath,
  [Parameter(Mandatory = $true)][string]$AppDirectory
)

$ErrorActionPreference = 'Stop'
# Windows tar/libarchive can reject UTF-8 names such as 韭号出行.exe.
# Read ZIP names through .NET and verify actual payloads, not just a listing.
$archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
try {
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $files = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName
    if ([string]::IsNullOrWhiteSpace($name) -or $name -match '[\\:\x00-\x1f]' -or
        $name.StartsWith('/') -or $name -match '(^|/)[.]{1,2}(/|$)' -or $name.Contains('//')) {
      throw "Unsafe or empty ZIP entry: $name"
    }
    if (-not $seen.Add($name.TrimEnd('/'))) { throw "Duplicate ZIP entry: $name" }
    if ($name.EndsWith('/')) { continue }
    $path = Join-Path $AppDirectory $name
    if (-not [System.IO.File]::Exists($path)) { throw "Unexpected ZIP file: $name" }
    $stream = $entry.Open()
    try {
      $hash = [Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($stream))
    } finally { $stream.Dispose() }
    $expected = Get-FileHash -LiteralPath $path -Algorithm SHA256
    if ($hash -ne $expected.Hash -or $entry.Length -ne (Get-Item -LiteralPath $path).Length) {
      throw "ZIP payload does not match unpacked file: $name"
    }
    [void]$files.Add($name)
  }
  foreach ($required in @('韭号出行.exe', 'resources/app.asar', 'resources/runtime/ninecli/ninecli.exe')) {
    if (-not $files.Contains($required)) { throw "ZIP is missing required file: $required" }
  }
  Write-Output "Verified $($files.Count) ZIP payloads against unpacked files"
} finally { $archive.Dispose() }
