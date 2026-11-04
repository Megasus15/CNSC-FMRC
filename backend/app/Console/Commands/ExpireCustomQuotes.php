<?php

namespace App\Console\Commands;

use App\Models\CustomProductQuote;
use App\Services\CustomQuoteExpiry;
use App\Support\CustomProductSchema;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ExpireCustomQuotes extends Command
{
    protected $signature = 'custom-products:expire';
    protected $description = 'Reconcile and close unpaid expired custom quotations';

    public function handle(): int
    {
        if (!CustomProductSchema::ready()) return self::SUCCESS;
        CustomProductQuote::whereIn('status', ['sent', 'accepted'])
            ->where(fn($q)=>$q->where('expires_at', '<=', now())->orWhereHas('order', fn($o)=>$o->whereIn('lifecycle_status', ['cancelled','rejected'])))
            ->whereDoesntHave('order.payment', fn($p)=>$p->where('status','paid'))
            ->chunkById(50, function ($quotes) {
                foreach ($quotes as $quote) {
                    try { CustomQuoteExpiry::close($quote); }
                    catch (\Throwable $error) { Log::warning('Custom quotation awaits reconciliation', ['quote_id'=>$quote->id]); }
                }
            });
        return self::SUCCESS;
    }
}
