param(
  [ValidateSet('chrome', 'edge')]
  [string]$Browser = 'chrome',
  [int]$Port = 9222,
  [string]$Url = 'http://localhost:3000'
)

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)

$edgeCandidates = @(
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$candidates = if ($Browser -eq 'edge') { $edgeCandidates } else { $chromeCandidates }
$exe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $exe) {
  throw "$Browser executable not found."
}

$profileDir = Join-Path $env:TEMP "vscode-$Browser-debug"
$args = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profileDir",
  $Url
)

Start-Process -FilePath $exe -ArgumentList $args | Out-Null

# Give the browser a short time to open the debug port before VSCode attaches.
$deadline = (Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 250
  try {
    $tcp = New-Object System.Net.Sockets.TcpClient('127.0.0.1', $Port)
    if ($tcp.Connected) {
      $tcp.Close()
      break
    }
  } catch {
    # retry until deadline
  }
} while ((Get-Date) -lt $deadline)
