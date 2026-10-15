"""Build an allowlisted GCash update using the existing root-relative PWA release format."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, zipfile
ROOT = Path(__file__).resolve().parents[2]
FILES = [
    "products-page/paymongo-simulator.html",
    "about-page/about.html",
    "admin-page/orders.html",
    "admin-page/orders.js",
    "backend/.env.example",
    "backend/app/Http/Controllers/Api/AdminDashboardController.php",
    "backend/app/Http/Controllers/Api/CustomerPaymentMethodController.php",
    "backend/app/Http/Controllers/Api/OrderController.php",
    "backend/app/Http/Controllers/Api/OrderReturnController.php",
    "backend/app/Http/Controllers/Api/PayMongoWebhookController.php",
    "backend/app/Http/Controllers/Api/ReportController.php",
    "backend/app/Http/Controllers/Api/SiteSettingController.php",
    "backend/app/Models/Order.php",
    "backend/app/Models/Payment.php",
    "backend/app/Services/PayMongoService.php",
    "backend/app/Support/FinancialMetrics.php",
    "backend/app/Support/ReturnPresenter.php",
    "backend/config/payments.php",
    "backend/routes/api.php",
    "backend/routes/console.php",
    "contact-page/contact.html",
    "home-page/main.html",
    "home-page/main.js",
    "products-page/payment-availability.js",
    "products-page/product.html",
    "products-page/products.js",
    "services-page/service.html",
    "staff-page/orders.html",
    "admin-page/gateway-payments.css",
    "admin-page/gateway-payments.js",
    "backend/.env.paymongo.example",
    "backend/app/Console/Commands/ReconcilePayments.php",
    "backend/app/Console/Commands/CheckPayments.php",
    "backend/app/Http/Controllers/Api/GatewayManagementController.php",
    "backend/app/Services/GatewayPayments.php",
    "backend/app/Support/GatewayFinancials.php",
    "backend/database/migrations/2027_01_06_000000_create_gateway_payment_ledger.php",
    "backend/database/migrations/2027_01_07_000000_add_checkout_method_to_payment_ledger.php",
    "backend/payments-hostinger-cron.php",
    "docs/GCASH_PAYMONGO_SETUP.md",
    "docs/HOSTINGER_QR_PRODUCTION_RELEASE.md",
    "home-page/payment-dialogs.css",
    "products-page/gateway-payments.css",
    "products-page/gateway-payments.js",
    "backend/database/migrations/2027_01_05_000000_add_paymongo_columns_to_payments.php"
]
ARCHIVE = ROOT / "output/fmrc-gcash-payment-update.zip"
assert len(FILES) == len(set(FILES))
sources = {}
for name in FILES:
    source = ROOT / name
    assert source.is_file() and not source.is_symlink(), name
    assert name != "backend/.env" and not name.startswith("backend/tests/"), name
    sources[name] = source.read_bytes()
sources["FMRC_GCASH_UPDATE.json"] = (json.dumps({"built_at": datetime.now(timezone.utc).isoformat(), "release": "gcash-qrph-hosted-v2", "enabled_by_default": False, "source_sha256": {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}}, indent=2) + "\n").encode()
ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(ARCHIVE, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, data in sources.items():
        archive.writestr(name, data)
with zipfile.ZipFile(ARCHIVE) as archive:
    assert archive.testzip() is None
    assert set(archive.namelist()) == set(sources)
    for name, data in sources.items():
        assert archive.read(name) == data
print(str(ARCHIVE) + " (" + str(len(sources)) + " verified entries)")
