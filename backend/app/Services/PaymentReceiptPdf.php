<?php

namespace App\Services;

use App\Models\OrderPaymentReceipt;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

final class PaymentReceiptPdf
{
    public function render(OrderPaymentReceipt $receipt): string
    {
        $fontPath = resource_path('fonts/receipts');
        $disk = Storage::disk('local');
        $directory = $receipt->exists ? 'receipt-renderer' : 'receipt-sample-renderer';
        if (! $disk->makeDirectory($directory)) {
            throw new RuntimeException('The private receipt render directory could not be created.');
        }
        $cache = $disk->path($directory);
        $logo = file_get_contents(public_path('images/FMRC Logo.png'));
        if ($logo === false) {
            throw new RuntimeException('The local FMRC logo could not be loaded.');
        }

        $options = new Options([
            'chroot' => [$fontPath, $cache],
            'tempDir' => $cache,
            'fontDir' => $cache,
            'fontCache' => $cache,
            'defaultFont' => 'DejaVu Sans',
            'isFontSubsettingEnabled' => true,
            'isRemoteEnabled' => false,
            'isPhpEnabled' => false,
            'isJavascriptEnabled' => false,
        ]);
        $pdf = new Dompdf($options);
        $pdf->setBasePath($fontPath.DIRECTORY_SEPARATOR);
        $pdf->setPaper('A4');
        $pdf->loadHtml(view('receipts.payment', [
            'number' => $receipt->number(),
            'details' => $receipt->snapshot,
            'money' => OrderPaymentReceipts::pesos(...),
            'logo' => 'data:image/png;base64,'.base64_encode($logo),
        ])->render(), 'UTF-8');
        $pdf->render();
        $pdf->addInfo('Title', 'UCN-FMRC Payment Receipt '.$receipt->number());
        $canvas = $pdf->getCanvas();
        $canvas->page_text(
            48, $canvas->get_height() - 30,
            $receipt->number().'  |  Page {PAGE_NUM} of {PAGE_COUNT}',
            $pdf->getFontMetrics()->getFont('Montserrat'),
            8, [0.32, 0.34, 0.38],
        );

        return $pdf->output();
    }
}
