# One-time native scaffolding for the mobile app. Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File mobile\tool\setup.ps1
# Safe to re-run: `flutter create` skips files that already exist (lib/, pubspec.yaml, test/).

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
    flutter create . --org com.devcipator --project-name chat_app --platforms android,ios
    if ($LASTEXITCODE -ne 0) { throw 'flutter create failed' }

    # Flutter only grants INTERNET to debug/profile builds; release APKs need it
    # in the main manifest or Supabase calls fail silently.
    $manifest = Join-Path $root 'android\app\src\main\AndroidManifest.xml'
    $xml = [IO.File]::ReadAllText($manifest)
    if ($xml -notmatch 'android\.permission\.INTERNET') {
        $xml = $xml -replace '(<manifest[^>]*>)', "`$1`n    <uses-permission android:name=`"android.permission.INTERNET`" />"
    }
    $xml = $xml -replace 'android:label="chat_app"', 'android:label="Chat App"'
    [IO.File]::WriteAllText($manifest, $xml)  # UTF-8 without BOM

    # iOS display name
    $plist = Join-Path $root 'ios\Runner\Info.plist'
    if (Test-Path $plist) {
        $p = [IO.File]::ReadAllText($plist)
        $p = $p -replace '(<key>CFBundleDisplayName</key>\s*<string>)[^<]*(</string>)', '${1}Chat App${2}'
        [IO.File]::WriteAllText($plist, $p)
    }

    if (-not (Test-Path (Join-Path $root 'env.json'))) {
        Copy-Item (Join-Path $root 'env.example.json') (Join-Path $root 'env.json')
        Write-Warning 'Created env.json from the example. Fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.'
    }

    flutter pub get
    if ($LASTEXITCODE -ne 0) { throw 'flutter pub get failed' }
    Write-Host "`nSetup complete. Next: flutter analyze; flutter test; flutter build apk --split-per-abi --dart-define-from-file=env.json" -ForegroundColor Green
}
finally {
    Pop-Location
}
