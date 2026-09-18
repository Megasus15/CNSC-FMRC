const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const postcss = require("../../node_modules/postcss");
const lightningcss = require("../../node_modules/lightningcss");

const root = path.resolve(__dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("About page exposes the shared image preview and CTA spacing hooks", () => {
  const about = read("about-page/about.html");
  const home = read("home-page/main.html");
  const main = read("home-page/main.js");
  const editorialCss = read("home-page/customer-editorial.css");

  assert.match(about, /id="missionImgEl"/);
  assert.match(about, /id="visionImgEl"/);
  assert.match(about, /id="serviceImageLightboxModal"/);
  assert.match(about, /id="serviceLightboxImage"/);
  assert.match(main, /openAboutImageLightbox/);
  assert.match(main, /role", "button"/);
  assert.match(main, /editorial-gallery \.vm-deck__card/);
  assert.match(editorialCss, /\.about-editorial-page #serviceImageLightboxModal \.lightbox-close-btn:focus-visible/);
  assert.match(home, /editorial-section editorial-cta-section/);
  assert.match(about, /editorial-section editorial-cta-section/);
  assert.match(editorialCss, /\.editorial-content \.editorial-cta-section/);
});

test("shared footer removes only item separators and keeps the tier divider", () => {
  const css = read("home-page/customer-footer.css");
  const itemRule = css.match(
    /\.site-footer \.footer-menu li,\s*\.site-footer \.footer-public-menu li\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(itemRule, "Quick/Public link item rule should remain present");
  assert.doesNotMatch(itemRule, /border-bottom\s*:\s*1px/);
  assert.match(css, /\.site-footer \.footer-tier-divider[\s\S]*?background:/);
  assert.match(css, /\.site-footer \.footer-kicker::after[\s\S]*?background:/);
});

test("Products uses the requested responsive skeleton contract", () => {
  const source = read("products-page/products.js");
  assert.match(source, /const viewportWidth = window\.innerWidth \|\| 1100/);
  assert.match(source, /const cardCount = viewportWidth >= 1100 \? 6 : 4/);
  assert.match(source, /Array\.from\(\{ length: cardCount \}\)/);
});

test("promotion theme copy is scoped to the Product promotion card", () => {
  for (const file of ["admin-page/promotions.html", "staff-page/promotions.html"]) {
    const source = read(file);
    assert.match(source, /Customize Promotion Card Theme/);
    assert.match(source, /These settings affect only the promotion card/);
    assert.doesNotMatch(source, /Customize Announcement &amp; Promotion Theme/);
  }
});

test("changed customer styles parse without CSS warnings", () => {
  for (const file of [
    "home-page/main.css",
    "home-page/customer-editorial.css",
    "home-page/customer-footer.css",
    "home-page/announcement-card.css",
  ]) {
    const css = read(file);
    postcss.parse(css, { from: file });
    const result = lightningcss.transform({
      filename: file,
      code: Buffer.from(css),
      errorRecovery: false,
    });
    assert.deepEqual(result.warnings, [], file);
  }
});
