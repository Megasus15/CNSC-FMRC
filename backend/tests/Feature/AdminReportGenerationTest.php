<?php

namespace Tests\Feature;

use App\Models\ReportGeneration;
use App\Models\User;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

class AdminReportGenerationTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_generation_requires_authentication_and_an_admin_or_staff_role(): void
    {
        $this->postJson('/api/admin/reports/generate', $this->payload('unauthenticated-key'))
            ->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->postJson('/api/admin/reports/generate', $this->payload('customer-key'))
            ->assertForbidden();

        foreach (['admin', 'staff'] as $role) {
            $this->actingAsRole($role);

            $response = $this->postJson('/api/admin/reports/generate', $this->payload("{$role}-key"));
            $response
                ->assertOk()
                ->assertJsonPath('data.report.category', 'sales')
                ->assertJsonPath('data.report.generated_by_role', $role);
            $this->assertStringContainsString(
                'no-store',
                (string) $response->headers->get('Cache-Control'),
            );
        }

        $this->assertSame(2, ReportGeneration::query()->count());
    }

    public function test_generation_validates_filters_and_the_client_key(): void
    {
        $this->actingAsRole('admin');

        $this->postJson('/api/admin/reports/generate')
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category', 'period', 'year', 'generation_key']);

        $this->postJson('/api/admin/reports/generate', [
            'category' => 'invalid',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
            'generation_key' => str_repeat('x', 101),
        ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['category', 'generation_key']);

        $this->assertSame(0, ReportGeneration::query()->count());
    }

    public function test_get_is_read_only_and_generate_is_idempotent(): void
    {
        $admin = $this->actingAsRole('admin');
        $filters = $this->filters();

        $this->getJson('/api/admin/reports?'.http_build_query($filters))
            ->assertOk();
        $this->assertSame(0, ReportGeneration::query()->count());

        $first = $this->postJson(
            '/api/admin/reports/generate',
            $filters + ['generation_key' => 'same-intent-key'],
        );
        $second = $this->postJson(
            '/api/admin/reports/generate',
            $filters + ['generation_key' => 'same-intent-key'],
        );

        $first->assertOk();
        $second->assertOk();
        $this->assertSame($first->json('data.report.id'), $second->json('data.report.id'));
        $this->assertSame($first->json('data.report.generated_at'), $second->json('data.report.generated_at'));
        $this->assertSame(1, ReportGeneration::query()->count());
        $this->assertDatabaseHas('report_generations', [
            'generation_key' => 'same-intent-key',
            'generated_by_user_id' => $admin->id,
            'category' => 'sales',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
            'quarter' => null,
        ]);

        $this->getJson('/api/admin/reports?'.http_build_query($filters))
            ->assertOk();
        $this->assertSame(1, ReportGeneration::query()->count());

        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()
            ->assertJsonPath('data.generated_reports', 1);
        $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.counts.generated_reports', 1);
    }

    public function test_persisted_preparer_name_supports_the_full_user_name_length(): void
    {
        $name = str_repeat('N', 255);
        $admin = User::factory()->create([
            'name' => $name,
            'role' => 'admin',
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/admin/reports/generate', $this->payload('full-name-key'))
            ->assertOk()
            ->assertJsonPath('data.report.generated_by', $name);

        $this->assertDatabaseHas('report_generations', [
            'generation_key' => 'full-name-key',
            'generated_by_user_id' => $admin->id,
            'generated_by_name' => $name,
        ]);
        $this->assertSame(
            255,
            strlen((string) ReportGeneration::query()->value('generated_by_name')),
        );
    }

    public function test_distinct_generation_keys_receive_unique_codes_at_the_same_clock_time(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-21 12:34:56.789', 'Asia/Manila'));
        $this->actingAsRole('admin');

        $first = $this->postJson(
            '/api/admin/reports/generate',
            $this->payload('same-clock-first-key'),
        )->assertOk();
        $second = $this->postJson(
            '/api/admin/reports/generate',
            $this->payload('same-clock-second-key'),
        )->assertOk();

        $firstCode = (string) $first->json('data.report.id');
        $secondCode = (string) $second->json('data.report.id');
        $this->assertMatchesRegularExpression('/^SAL-20260821-\d{6}$/', $firstCode);
        $this->assertMatchesRegularExpression('/^SAL-20260821-\d{6}$/', $secondCode);
        $this->assertNotSame($firstCode, $secondCode);
        $this->assertSame(2, ReportGeneration::query()->distinct()->count('report_code'));

        $uniqueReportCodeIndex = collect(Schema::getIndexes('report_generations'))
            ->first(fn (array $index): bool => (bool) ($index['unique'] ?? false)
                && array_values($index['columns'] ?? []) === ['report_code']);
        $this->assertNotNull($uniqueReportCodeIndex);
    }

    public function test_a_key_cannot_be_reused_for_other_filters_or_another_user(): void
    {
        $this->actingAsRole('admin');
        $payload = $this->payload('scoped-key');

        $this->postJson('/api/admin/reports/generate', $payload)->assertOk();

        $this->postJson('/api/admin/reports/generate', array_replace($payload, [
            'category' => 'appointments',
        ]))
            ->assertConflict()
            ->assertJsonPath('code', 'REPORT_GENERATION_KEY_CONFLICT')
            ->assertJsonMissingPath('data.report.id');

        $this->actingAsRole('admin');
        $this->postJson('/api/admin/reports/generate', $payload)
            ->assertConflict()
            ->assertJsonPath('code', 'REPORT_GENERATION_KEY_CONFLICT')
            ->assertJsonMissingPath('data.report.id');

        $this->assertSame(1, ReportGeneration::query()->count());
    }

    public function test_a_missing_audit_table_is_created_on_first_generation(): void
    {
        $this->actingAsRole('admin');
        Schema::drop('report_generations');

        // The Hostinger deploy copies files only, so a released build can reach
        // the server before `php artisan migrate` is run by hand. Generating a
        // report must never be blocked by that, and the audit row must still be
        // written so the dashboard "Generated Reports" card is not stuck at 0.
        $response = $this->postJson(
            '/api/admin/reports/generate',
            $this->payload('migration-pending-key'),
        );
        $response
            ->assertOk()
            ->assertJsonPath('data.report.category', 'sales');
        $this->assertStringContainsString(
            'no-store',
            (string) $response->headers->get('Cache-Control'),
        );
        $this->assertMatchesRegularExpression(
            '/^SAL-\d{8}-\d{6}$/',
            (string) $response->json('data.report.id'),
        );

        $this->assertTrue(Schema::hasTable('report_generations'));
        $this->assertTrue(ReportGeneration::schemaAvailable());
        $this->assertDatabaseHas('report_generations', [
            'generation_key' => 'migration-pending-key',
            'category' => 'sales',
        ]);

        $this->getJson('/api/admin/reports?'.http_build_query($this->filters()))
            ->assertOk();

        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()
            ->assertJsonPath('data.generated_reports', 1)
            ->assertJsonPath('data.availability.report_generations', true);

        $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.counts.generated_reports', 1)
            ->assertJsonPath('data.availability.report_generations', true);
    }

    public function test_an_incompatible_audit_table_is_left_alone_and_never_blocks_a_report(): void
    {
        $this->actingAsRole('admin');
        Schema::drop('report_generations');
        // A table this application does not own: it must not be altered, and the
        // operator must still get the document.
        Schema::create('report_generations', function (Blueprint $table): void {
            $table->id();
            $table->string('unrelated_column');
        });

        $first = $this->postJson(
            '/api/admin/reports/generate',
            $this->payload('incompatible-schema-key'),
        )
            ->assertOk()
            ->assertJsonPath('data.report.category', 'sales');

        $this->assertMatchesRegularExpression('/^SAL-TEMP-[A-F0-9]{16}$/', $first->json('data.report.id'));
        Carbon::setTestNow(Carbon::now('Asia/Manila')->addDay());
        $this->postJson('/api/admin/reports/generate', $this->payload('incompatible-schema-key'))
            ->assertOk()->assertJsonPath('data.report.id', $first->json('data.report.id'));

        $this->assertFalse(ReportGeneration::schemaAvailable());
        $this->assertSame(
            ['id', 'unrelated_column'],
            Schema::getColumnListing('report_generations'),
        );

        $this->getJson('/api/admin/dashboard/live-counts')
            ->assertOk()
            ->assertJsonPath('data.generated_reports', 0)
            ->assertJsonPath('data.availability.report_generations', false);

        $this->getJson('/api/admin/dashboard/summary')
            ->assertOk()
            ->assertJsonPath('data.counts.generated_reports', 0)
            ->assertJsonPath('data.availability.report_generations', false);
    }

    public function test_all_categories_use_compact_codes_with_the_manila_generation_date_and_audit_sequence(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-16 16:30:00', 'UTC'));
        $this->actingAsRole('staff');
        $categories = [
            'sales' => 'SAL',
            'completed_orders' => 'CMP',
            'processing_orders' => 'PRC',
            'appointments' => 'APT',
            'inventory' => 'INV',
        ];

        foreach ($categories as $category => $prefix) {
            $payload = array_replace($this->payload('compact-'.$category), ['category' => $category]);
            $this->getJson('/api/admin/reports?'.http_build_query($payload))
                ->assertOk()->assertJsonPath('data.report.id', $prefix.'-20260917-DRAFT');
            $this->assertDatabaseMissing('report_generations', ['generation_key' => $payload['generation_key']]);

            $response = $this->postJson('/api/admin/reports/generate', $payload)->assertOk();
            $audit = ReportGeneration::query()->where('generation_key', $payload['generation_key'])->firstOrFail();
            $expected = $prefix.'-20260917-'.str_pad((string) $audit->id, 6, '0', STR_PAD_LEFT);
            $response->assertJsonPath('data.report.id', $expected);
            $this->assertSame($expected, $audit->report_code);
            $this->assertSame(19, strlen($expected));
        }

        $this->assertSame(5, ReportGeneration::query()->distinct()->count('report_code'));
    }

    public function test_replaying_a_compact_report_after_midnight_preserves_original_identity_and_preparer(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-17 23:59:59', 'Asia/Manila'));
        $actor = $this->actingAsRole('admin');
        $first = $this->postJson('/api/admin/reports/generate', $this->payload('midnight-retry'))->assertOk();
        Carbon::setTestNow(Carbon::parse('2026-09-18 00:00:01', 'Asia/Manila'));
        $actor->name = 'Changed preparer name';

        $this->postJson('/api/admin/reports/generate', $this->payload('midnight-retry'))
            ->assertOk()
            ->assertJsonPath('data.report.id', $first->json('data.report.id'))
            ->assertJsonPath('data.report.generated_at', $first->json('data.report.generated_at'))
            ->assertJsonPath('data.report.generated_by', $first->json('data.report.generated_by'));
        $this->assertSame(1, ReportGeneration::query()->count());
    }

    public function test_replaying_a_historical_generation_keeps_its_stored_long_code(): void
    {
        $actor = $this->actingAsRole('admin');
        $legacyCode = 'RPT-SALES-'.strtoupper(hash('sha256', 'historical-key'));
        ReportGeneration::create([
            'generation_key' => 'historical-key',
            'generated_by_user_id' => $actor->id,
            'generated_by_name' => 'Original preparer',
            'generated_by_role' => 'admin',
            'report_code' => $legacyCode,
            'category' => 'sales',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
            'quarter' => null,
        ]);

        $this->postJson('/api/admin/reports/generate', $this->payload('historical-key'))
            ->assertOk()
            ->assertJsonPath('data.report.id', $legacyCode)
            ->assertJsonPath('data.report.generated_by', 'Original preparer');
        $this->assertDatabaseHas('report_generations', ['report_code' => $legacyCode]);
        $this->assertSame(1, ReportGeneration::query()->count());
    }

    public function test_failure_to_finalize_compact_code_rolls_back_the_audit_insert_and_allows_retry(): void
    {
        $this->actingAsRole('admin');
        $event = 'eloquent.updating: '.ReportGeneration::class;
        Event::listen($event, function (): void {
            throw new RuntimeException('Simulated report code write failure');
        });
        $this->withoutExceptionHandling();

        try {
            $this->postJson('/api/admin/reports/generate', $this->payload('rollback-key'));
            $this->fail('Expected the code finalization write to fail.');
        } catch (RuntimeException $exception) {
            $this->assertSame('Simulated report code write failure', $exception->getMessage());
        } finally {
            Event::forget($event);
        }

        $this->assertSame(0, ReportGeneration::query()->count());
        $response = $this->postJson('/api/admin/reports/generate', $this->payload('rollback-key'))->assertOk();
        $this->assertMatchesRegularExpression('/^SAL-\d{8}-\d{6}$/', $response->json('data.report.id'));
        $this->assertSame(1, ReportGeneration::query()->count());
    }

    private function actingAsRole(string $role): User
    {
        // SQLite retains the original users-role CHECK constraint. Persist an
        // Admin fixture and expose Staff on the authenticated in-memory model.
        $persistedRole = $role === 'staff' ? 'admin' : $role;
        $user = User::factory()->create(['role' => $persistedRole]);
        if ($role === 'staff') {
            $user->setAttribute('role', 'staff');
        }
        Sanctum::actingAs($user);

        return $user;
    }

    /** @return array<string, int|string> */
    private function filters(): array
    {
        return [
            'category' => 'sales',
            'period' => 'monthly',
            'year' => 2026,
            'month' => 4,
        ];
    }

    /** @return array<string, int|string> */
    private function payload(string $generationKey): array
    {
        return $this->filters() + ['generation_key' => $generationKey];
    }
}
