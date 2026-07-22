# Script to replace CNSC -> UCN in UI display text only
# Does NOT change: email addresses, image file paths, backend logic

$baseDir = "c:\Users\T480\Documents\GitHub\CNSC-FMRC"

$files = @(
  "home-page\main.html",
  "home-page\main.js",
  "contact-page\contact.html",
  "products-page\product.html",
  "services-page\service.html",
  "customer-auth\auth.html",
  "admin-auth\auth.html",
  "admin-page\accounts.html",
  "admin-page\appointments.html",
  "admin-page\archives.html",
  "admin-page\customer-inquiries.html",
  "admin-page\dashboard.html",
  "admin-page\inventory.html",
  "admin-page\my-account.html",
  "admin-page\orders.html",
  "admin-page\products.html",
  "admin-page\reports.html",
  "admin-page\website-contact.html",
  "admin-page\website-footer.html",
  "admin-page\website-home.html",
  "admin-page\website-services.html",
  "staff-page\appointments.html",
  "staff-page\archives.html",
  "staff-page\customer-inquiries.html",
  "staff-page\dashboard.html",
  "staff-page\inventory.html",
  "staff-page\my-account.html",
  "staff-page\orders.html",
  "staff-page\products.html",
  "staff-page\reports.html",
  "staff-page\website-contact.html",
  "staff-page\website-footer.html",
  "staff-page\website-home.html",
  "staff-page\website-services.html",
  "cashier-page\archives.html",
  "cashier-page\dashboard.html",
  "cashier-page\my-account.html",
  "cashier-page\payment-monitoring.html"
)

$totalUpdated = 0

foreach ($f in $files) {
  $path = Join-Path $baseDir $f
  if (Test-Path $path) {
    $content = [System.IO.File]::ReadAllText($path)
    $original = $content

    # 1. Replace 'CAMARINES NORTE STATE COLLEGE' (all-caps header display)
    $content = $content.Replace("CAMARINES NORTE STATE COLLEGE", "UNIVERSITY OF CAMARINES NORTE")

    # 2. Replace 'Camarines Norte State College (CNSC)' -> 'University of Camarines Norte (UCN)'
    $content = $content.Replace("Camarines Norte State College (CNSC)", "University of Camarines Norte (UCN)")

    # 3. Replace remaining 'Camarines Norte State College' (NOT in URLs/emails)
    # We use line-by-line to avoid changing google maps URLs
    $lines = $content -split "`n"
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $line = $lines[$i]
      # Skip lines with google maps URLs or href containing maps
      if ($line -match "google\.com/maps" -or $line -match "api=1") { continue }
      # Skip lines with email addresses
      if ($line -match "mailto:" -or $line -match "@cnsc\.edu\.ph") { continue }
      # Skip image src lines
      if ($line -match 'src=".*CNSC.*\.(png|jpg|svg)"') { continue }
      # Skip alt text for images
      if ($line -match 'alt="CNSC Logo"') { continue }
      # Replace display text
      $lines[$i] = $line.Replace("Camarines Norte State College", "University of Camarines Norte")
    }
    $content = $lines -join "`n"

    # 4. Replace CNSC-FMRC in <title> tags
    $content = [regex]::Replace($content, '(<title>)([^<]*?)(</title>)', {
      param($m)
      $titleText = $m.Groups[2].Value.Replace("CNSC-FMRC", "UCN-FMRC").Replace("CNSC - FMRC", "UCN - FMRC").Replace("CNSC FMRC", "UCN FMRC")
      return $m.Groups[1].Value + $titleText + $m.Groups[3].Value
    })

    # 5. Replace <h2>CNSC-FMRC</h2> sidebar headers
    $content = $content.Replace("<h2>CNSC-FMRC</h2>", "<h2>UCN-FMRC</h2>")

    # 6. Replace auth caption text
    $content = $content.Replace("CNSC-FMRC Admin Access", "UCN-FMRC Admin Access")
    $content = $content.Replace("CNSC-FMRC Customer", "UCN-FMRC Customer")

    # 7. Replace footer brand name display
    $content = $content.Replace('>CNSC- FMRC</h3>', '>UCN- FMRC</h3>')
    $content = $content.Replace('>CNSC- FMRC</h1>', '>UCN- FMRC</h1>')

    # 8. Replace logo-text h1
    $content = $content.Replace('>CNSC-FMRC</h1>', '>UCN-FMRC</h1>')

    # 9. Replace 'CNSC FMRC' display text (facebook labels, vision/mission text, copyright)
    # But NOT in email, src, or alt contexts
    $lines2 = $content -split "`n"
    for ($i = 0; $i -lt $lines2.Count; $i++) {
      $line = $lines2[$i]
      if ($line -match "mailto:" -or $line -match "@cnsc\.edu\.ph") { continue }
      if ($line -match 'src=".*CNSC') { continue }
      if ($line -match 'alt="CNSC') { continue }
      $lines2[$i] = $line.Replace("CNSC FMRC", "UCN FMRC").Replace("CNSC Fabrication", "UCN Fabrication")
    }
    $content = $lines2 -join "`n"

    # 10. Replace CNSC-FMRC in popup identity text (staff@cnsc... display)
    # These show "staff@cnsc.edu.ph" as visible text - keep email addresses as-is

    # 11. Replace placeholder text in admin forms
    $content = $content.Replace('placeholder="CNSC FMRC"', 'placeholder="UCN FMRC"')
    $content = $content.Replace('placeholder="CNSC- FMRC"', 'placeholder="UCN- FMRC"')
    $content = [regex]::Replace($content, 'placeholder="[^"]*CNSC Fabrication[^"]*"', {
      param($m)
      return $m.Value.Replace("CNSC Fabrication", "UCN Fabrication")
    })

    # 12. Replace QR code text in JS
    $content = $content.Replace('"CNSC-FMRC QR PASS"', '"UCN-FMRC QR PASS"')

    # 13. Replace 'By entering the CNSC Fabrication' text
    $content = $content.Replace("the CNSC Fabrication", "the UCN Fabrication")

    # 14. Replace copyright text
    $content = [regex]::Replace($content, '2026 CNSC Fabrication', '2026 UCN Fabrication')

    # 15. Replace 'At Camarines Norte State College' and similar in visible paragraphs  
    # (already handled by step 3 above)

    if ($content -ne $original) {
      [System.IO.File]::WriteAllText($path, $content)
      $totalUpdated++
      Write-Output "Updated: $f"
    } else {
      Write-Output "No changes: $f"
    }
  } else {
    Write-Output "NOT FOUND: $f"
  }
}

Write-Output "`nTotal files updated: $totalUpdated"
