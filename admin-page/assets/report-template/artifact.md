# UCN official report template reference

This folder contains artwork extracted from the user-supplied
`UCN-Endorsement-new-template.docx` for the Admin/Staff Reports preview and
Print / Save PDF flow. The source DOCX SHA-256 is
`85FEC2832C1C3680F64AEC06FCE8E596EAC15BB20F8F6B69D980543FAEE7E962`.

## Current typography and geometry reference

The user-supplied `FMRC-INVENTORY-PROCESS.pdf` supersedes the older DOCX for
typography and paper size. Its SHA-256 is
`83D24AD70261200E41A6F2746BE0B1C2BAB0D87854F746D7A4C0FD27882F6986`.
The first page was rendered and its text fonts and sizes were inspected.

- Paper: A4 portrait (the source measures 595.4 x 841.8 points).
- Fonts: ArialMT, Arial-BoldMT, and Arial-ItalicMT. Main text is 11pt;
  Republic 10pt; university 14pt bold; former-name 10pt italic; address 8pt;
  contacts 6pt; certification text 6.6pt with 5.6pt small print; document
  control and page numbers 8pt.
- The PDF uses locally installed Arial faces, checked before print/preview.
  No proprietary font files are redistributed.

## Retained content

- Body margins: 1 inch.
- Preserve the Republic/University/former-name/address/web/email/social header,
  maroon divider, official certification footer, `CNSC-SP-QMS-05F5`,
  `Revision: 1`, and dynamic `Page N of M`.
- Replace only the source unit block with
  `FABRICATION AND MANUFACTURING RESEARCH CENTER`.
- Resolve the FMRC email and phone from public Site Settings, falling back to
  `cnscfmrc@gmail.com / 0909-099-0000` when offline.
- Endorsement/advisory bodies, recipients, dates, and signatures in the source
  DOCX and supplied screenshot are examples and are not report content.

The reusable HTML document construction is in `../../reports.js`; the base
layout is in `../../admin-modules.css`, with the current A4 geometry and Arial
typography in `../../report-document.css`. Header/footer text remains editable
through Edit Letterhead. Each PDF page anchors those bands outside its measured
body area. Reports retain Print / Save PDF and Export CSV.

## Extracted artwork checksums

| File | SHA-256 |
| --- | --- |
| `bagong-pilipinas.png` | `7729B796ADC34BD283D00B44F4970A5A3AE84DB738ED84212FB7A94C6F7E5D4B` |
| `csc-prime.png` | `925A86CA5CAC430884586701729476AA860ADDC4216AC72BEC144A4E32F92F00` |
| `email-icon.png` | `63367D90BC98E758A843705895E074EE5461DCA44EBB3E8585403EFED8D74201` |
| `facebook-icon.png` | `10D41DC74AB14FC9999001A83729AA528C9E01D68CB536E9A70A9F5040BA6506` |
| `iso-certification.jpeg` | `C57AEF7AE50F0885CE22301102A32C57DA39499B521499DDD88D3187D1049D64` |
| `iso-qr.png` | `F5EC03786552678866BC97F8DE3F130739063FCFD4ACE2DCA9315112DF2418F5` |
| `philippine-quality-award.png` | `344636426720774C829AD10B2D23E63101256AE25E048C30EE9A318EB31C69F2` |
| `sustainable-development-goals.png` | `A17F7C76771F958D72351FBFAB8B4BF2E4C985E3B41A8E655F25668449AB4614` |
| `ucn-mark.png` | `DD2C65C48F1205BDC6C910ECE9B2057E6E664BAEE72C4109F547B2512FD4E0C7` |
| `web-icon.jpeg` | `9A3BC009F4DC9E04FC7FAA09DD65D2D7172E50903A4629577DC448DD13C66B46` |
| `wuri.jpeg` | `57DCA513DEF85721EAFDCB258EE82108A7C67A5EDCC7D1B2B16C9CC6313D2C0D` |

## Verification note

The artwork files and supplied PDF were visually inspected. Final browser
print output still requires a rendered smoke check; structural checks alone
do not prove visual equivalence. Importing a PDF into Word invokes Word's
conversion process and cannot guarantee the PDF layout. Word also dims inactive
header/footer areas while editing the body; this is not document protection.
