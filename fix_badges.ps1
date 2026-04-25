$files = Get-ChildItem 'C:\Users\T480\Documents\GitHub\CNSC-FMRC\admin-page\*.html'
foreach ($f in $files) {
    $content = Get-Content $f.FullName -Raw -Encoding UTF8
    $orig = $content

    # Pattern 1: inline single-line notification divs with hardcoded number
    $content = $content -replace '(<div class="notifications">)\s*<i class="fa-regular fa-bell"></i>\s*<span class="badge">\d+</span>\s*(</div>)', '<div class="notifications" id="notifBell"><i class="fa-regular fa-bell"></i><span class="badge" id="notifBadge" style="display:none;"></span></div>'

    # Also fix if already has id="notifBell" but still has hardcoded number
    $content = $content -replace '(<div class="notifications"[^>]*>)\s*<i class="fa-regular fa-bell"></i>\s*<span class="badge">\d+</span>', '<div class="notifications" id="notifBell"><i class="fa-regular fa-bell"></i><span class="badge" id="notifBadge" style="display:none;"></span>'

    if ($content -ne $orig) {
        Set-Content $f.FullName $content -Encoding UTF8 -NoNewline
        Write-Host "Fixed: $($f.Name)"
    } else {
        Write-Host "No change: $($f.Name)"
    }
}
Write-Host "Done."
