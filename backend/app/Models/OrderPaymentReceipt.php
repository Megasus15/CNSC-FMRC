<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrderPaymentReceipt extends Model
{
    protected $guarded = ['id'];

    protected $casts = [
        'snapshot' => 'array',
        'pdf_ready_at' => 'datetime',
        'voided_at' => 'datetime',
        'next_attempt_at' => 'datetime',
        'sent_at' => 'datetime',
    ];

    public function number(): string
    {
        return 'FMRC-PR-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT);
    }

    public function filename(): string
    {
        return $this->number().'.pdf';
    }

    public function pdfPath(): string
    {
        return 'order-payment-receipts/'.$this->filename();
    }
}
