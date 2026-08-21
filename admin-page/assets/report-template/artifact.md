# UCN official report template reference

This folder contains artwork extracted from the user-supplied
`UCN-Endorsement-new-template.docx` for the Admin/Staff Reports preview and
Print / Save PDF flow. The source DOCX SHA-256 is
`85FEC2832C1C3680F64AEC06FCE8E596EAC15BB20F8F6B69D980543FAEE7E962`.

## Locked geometry and content

- Paper: US Letter portrait, 8.5 x 11 inches (`12240 x 15840` twips).
- Body margins: 1 inch.
- Source header/footer distance: `708` twips (approximately 0.492 inch).
- Preserve the Republic/University/former-name/address/web/email/social header,
  maroon divider, official certification footer, `CNSC-SP-QMS-05F5`,
  `Revision: 1`, and dynamic `Page N of M`.
- Replace only the source unit block with
  `FABRICATION AND MANUFACTURING RESEARCH CENTER`.
- Resolve the FMRC email and phone from public Site Settings, falling back to
  `cnscfmrc@gmail.com / 0909-099-0000` when offline.
- Endorsement/advisory bodies, recipients, dates, and signatures in the source
  DOCX and supplied screenshot are examples and are not report content.

The reusable HTML document construction is in `../../reports.js`; physical
page geometry and print rules are in `../../admin-modules.css`.

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

The artwork files were individually decoded and visually inspected. This
environment has no connected in-app browser, Word/LibreOffice renderer, or PDF
page renderer, so final print-dialog/PDF pixel comparison remains an explicit
deployment smoke check in `HOSTINGER_REPORTS_DEPLOYMENT.md`.
