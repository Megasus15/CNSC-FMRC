# Customer navbar preview

The shared navbar refinement is in `home-page/customer-navbar.css`, loaded by Home, About Us, Services, Products, and Contact. Page content and profile/modal markup were not changed for this navbar update.

## Previews

- [Desktop navbar](desktop-navbar.png)
- [Phone navbar](phone-navbar.png)
- [Mobile navigation](mobile-navigation.png)
- [Profile dropdown](profile-dropdown.png)
- [Confirm Logout](confirm-logout.png)
- [Phone Confirm Logout](phone-confirm-logout.png)

## Verification

Local headless Chrome rendered all five pages at 1440, 1024, 901, 768, 390, and 320 CSS pixels in guest and synthetic signed-in states (60 combinations). No horizontal page overflow, overlapping header siblings, or truncated visible Sign In labels were detected. Montserrat loaded successfully.

Computed styles were compared with the new stylesheet disabled and enabled. The guest dropdown had no changes. The customer dropdown and Confirm Logout modal had only the requested removal of `box-shadow` on their Log Out buttons, including phone layouts.

Guest dropdown Escape handling, mobile navigation opening and Escape dismissal, logout confirmation opening, cancellation preserving the session, keyboard focus visibility, and reduced-motion behavior passed. CSS parsing and whitespace checks passed.

These checks use local static pages and intercepted API fixtures in an isolated browser profile. They do not verify production deployment or live authentication/API behavior. The screenshots show fixture content and a synthetic customer identity.

Full measurements: [verification.json](verification.json).
