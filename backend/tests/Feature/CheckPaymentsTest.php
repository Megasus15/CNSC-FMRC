<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{Artisan, Cache, Http};
use Tests\TestCase;

class CheckPaymentsTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void {
        parent::setUp();
        config(['payments.gateway'=>'paymongo','payments.paymongo.enabled'=>false,'payments.paymongo.checkout_method'=>'qrph',
            'payments.paymongo.secret_key'=>'sk_test_privatefixture','payments.paymongo.webhook_secret'=>'whsec_privatefixture',
            'app.url'=>'https://staging.example.test','app.frontend_url'=>'https://staging.example.test']);
        Cache::put('payments:last_reconciled_at',now()->toIso8601String());
        Http::preventStrayRequests();
    }

    public function test_local_check_never_calls_provider_or_exposes_secrets(): void {
        $this->assertSame(0,Artisan::call('payments:check'));
        $output=Artisan::output();
        $this->assertStringContainsString('New checkout switch: disabled',$output);
        $this->assertStringNotContainsString('sk_test_privatefixture',$output);
        $this->assertStringNotContainsString('whsec_privatefixture',$output);
        Http::assertNothingSent();
    }

    public function test_provider_check_is_read_only_and_requires_selected_capability(): void {
        Http::fake(['api.paymongo.com/v1/merchants/capabilities/payment_methods'=>Http::response(['qrph'])]);
        $this->assertSame(0,Artisan::call('payments:check',['--provider'=>true]));
        Http::assertSent(fn($request)=>$request->method()==='GET' && str_ends_with($request->url(),'/capabilities/payment_methods'));
        config(['payments.paymongo.checkout_method'=>'gcash']);
        $this->assertSame(1,Artisan::call('payments:check',['--provider'=>true]));
        $this->assertStringContainsString('Selected method is unavailable',Artisan::output());
        Http::assertNotSent(fn($request)=>$request->method()!=='GET');
    }

    public function test_malformed_capability_response_fails_closed(): void {
        Http::fake(['api.paymongo.com/*'=>Http::response(['data'=>['qrph']])]);
        $this->assertSame(1,Artisan::call('payments:check',['--provider'=>true]));
        $this->assertStringContainsString('Could not verify the response',Artisan::output());
    }

    public function test_missing_credentials_and_stale_scheduler_fail_without_request(): void {
        config(['payments.paymongo.secret_key'=>'','payments.paymongo.webhook_secret'=>'']);
        Cache::put('payments:last_reconciled_at',now()->subMinutes(5)->toIso8601String());
        $this->assertSame(1,Artisan::call('payments:check',['--provider'=>true]));
        $output=Artisan::output();
        $this->assertStringContainsString('FAIL Private credentials',$output);
        $this->assertStringContainsString('FAIL Reconciliation scheduler',$output);
        Http::assertNothingSent();
    }
}
