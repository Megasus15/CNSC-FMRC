# UCN-FMRC branding release

`site-root-upload.zip` contains 71 root-relative runtime files. Extract its contents into the active Hostinger document root that currently contains `index.html` and `home-page/`. If uploading files one at a time, upload `images/UCN Logo.png` and `images/FMRC Brand Logo.png` before replacing the HTML and JavaScript.

The bundle includes the prior pending two-logo navbar and customer UI changes because they share `home-page/main.js` and page HTML. Review `SHA256SUMS.txt` before upload. Preserve the live `.htaccess` and `backend/.env`; neither is in the ZIP. No migration or database seeder is required.

After upload, verify these URLs return 200: `/images/UCN%20Logo.png`, `/images/FMRC%20Brand%20Logo.png`, `/home-page/main.html`, and `/admin-auth/auth`. Check all five customer navbars, both login pages, and the browser icon.

Existing Admin/Staff Brand Logos custom uploads override bundled defaults. At audit time, the live left navbar, footer, and portal uploads already showed the new UCN mark; the hero and browser uploads already showed FMRC. To show the exact newly supplied bundled defaults everywhere, use **Brand Logos → Default** on any slot still marked **Custom Upload** after deployment. This clears that slot's saved upload.

**Status:** Prepared locally only. No connected Hostinger hPanel/SFTP session or authenticated deployment tool was available here, so the ZIP has not been uploaded or verified on production.
