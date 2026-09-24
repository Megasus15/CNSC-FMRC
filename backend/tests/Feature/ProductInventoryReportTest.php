<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ReportGeneration;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProductInventoryReportTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_snapshot_matches_products_page_including_blocked_products_and_recorded_availability(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-09-24 14:30:00', 'Asia/Manila'));
        $this->actingAsRole('admin');
        $gear = $this->product('GEAR', 'Gear', 12, 125.50);
        $gear->forceFill(['created_at' => '2024-01-01 00:00:00', 'updated_at' => '2024-01-01 00:00:00'])->save();
        $blocked = $this->product('BEARING', 'Bearing', 5, 15.25, [
            'category' => 'Parts', 'is_blocked' => true, 'is_active' => false,
        ]);
        $empty = $this->product('EMPTY', 'Empty product', 0, 20);
        $unavailable = $this->product('BOLT', 'Bolt', 3, 2.10, [
            'category' => 'Parts', 'stock_status' => 'out_of_stock',
        ]);
        $deleted = $this->product('DELETED', 'Deleted product', 999, 100);
        $deleted->delete();

        $response = $this->getJson($this->reportsUrl())->assertOk()
            ->assertJsonPath('data.report.category', 'product_inventory')
            ->assertJsonPath('data.report.title', 'Overall Product Stock Report')
            ->assertJsonPath('data.report.scope', 'current_snapshot')
            ->assertJsonPath('data.report.snapshot_at', '2026-09-24T14:30:00+08:00')
            ->assertJsonPath('data.report.timezone', 'Asia/Manila')
            ->assertJsonCount(4, 'data.table.rows');
        $this->assertStringContainsString('independent of the selected reporting period', $response->json('data.report.scope_note'));
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));

        $metrics = collect($response->json('data.metrics'))->keyBy('key');
        $this->assertSame(4, $metrics['total_products']['value']);
        $this->assertSame(20, $metrics['units_on_hand']['value']);
        $this->assertSame(1, $metrics['out_of_stock']['value']);
        $this->assertEqualsWithDelta(1588.55, $metrics['stock_value']['value'], 0.001);

        $rows = collect($response->json('data.table.rows'))->keyBy('product_id');
        $this->assertSame('Blocked', $rows[$blocked->id]['visibility']);
        $this->assertSame('In Stock', $rows[$empty->id]['stock_status']);
        $this->assertSame(0, $rows[$empty->id]['stock']);
        $this->assertSame('Out of Stock', $rows[$unavailable->id]['stock_status']);
        $this->assertSame(3, $rows[$unavailable->id]['stock']);
        $this->assertEqualsWithDelta(1506, $rows[$gear->id]['stock_value'], 0.001);
        $this->assertSame(['Parts', 'Products'], $response->json('data.chart.labels'));
        $this->assertSame([8, 12], $response->json('data.chart.series.0.values'));
        $this->assertSame([
            ['label' => 'In Stock', 'value' => 3],
            ['label' => 'Out of Stock', 'value' => 1],
        ], $response->json('data.breakdown.items'));

        $catalog = $this->getJson('/api/admin/products')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(array_column($catalog, 'id'), $rows->keys()->all());
        $this->assertSame(array_sum(array_column($catalog, 'stock')), $metrics['units_on_hand']['value']);
        foreach ($catalog as $product) {
            $this->assertSame($product['stock'], $rows[$product['id']]['stock']);
            $this->assertSame($product['price'], $rows[$product['id']]['unit_price']);
        }

        $anotherPeriod = $this->getJson($this->reportsUrl([
            'period' => 'yearly', 'year' => 2024,
        ]))->assertOk();
        $this->assertSame($response->json('data.table'), $anotherPeriod->json('data.table'));
        $this->assertSame($response->json('data.metrics'), $anotherPeriod->json('data.metrics'));
        $this->assertSame(0, ReportGeneration::query()->count());
    }

    public function test_product_stock_reports_enforce_access_and_audit_admin_and_staff_generation(): void
    {
        $payload = $this->filters() + ['generation_key' => 'unauthenticated-stock'];
        $this->getJson($this->reportsUrl())->assertUnauthorized();
        $this->postJson('/api/admin/reports/generate', $payload)->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->getJson($this->reportsUrl())->assertForbidden();
        $this->postJson('/api/admin/reports/generate', $payload)->assertForbidden();

        foreach (['admin', 'staff'] as $role) {
            $actor = $this->actingAsRole($role);
            $payload['generation_key'] = $role.'-product-stock';
            $this->getJson($this->reportsUrl())->assertOk();
            $first = $this->postJson('/api/admin/reports/generate', $payload)->assertOk()
                ->assertJsonPath('data.report.generated_by_role', $role)
                ->assertJsonPath('data.report.scope', 'current_snapshot');
            $retry = $this->postJson('/api/admin/reports/generate', $payload)->assertOk();
            $this->assertMatchesRegularExpression('/^PIN-\d{8}-\d{6}$/', $first->json('data.report.id'));
            $this->assertSame($first->json('data.report.id'), $retry->json('data.report.id'));
            $this->assertDatabaseHas('report_generations', [
                'generated_by_user_id' => $actor->id,
                'category' => 'product_inventory',
                'generation_key' => $payload['generation_key'],
            ]);
        }

        $this->assertSame(2, ReportGeneration::query()->count());
    }

    public function test_empty_snapshot_is_valid_and_later_requests_use_current_stock(): void
    {
        $this->actingAsRole('admin');
        $empty = $this->getJson($this->reportsUrl())->assertOk()
            ->assertJsonCount(0, 'data.table.rows')
            ->assertJsonPath('data.chart.labels', [])
            ->assertJsonPath('data.chart.series.0.values', []);
        foreach ($empty->json('data.metrics') as $metric) {
            $this->assertEquals(0, $metric['value']);
        }

        $product = $this->product('CURRENT', 'Current product', 10, 5);
        $this->getJson($this->reportsUrl())->assertOk()
            ->assertJsonPath('data.table.rows.0.stock', 10);
        $product->update(['stock' => 2, 'price' => 7.50]);
        $this->getJson($this->reportsUrl())->assertOk()
            ->assertJsonPath('data.table.rows.0.stock', 2)
            ->assertJsonPath('data.table.rows.0.unit_price', 7.5)
            ->assertJsonPath('data.table.rows.0.stock_value', 15);
    }

    private function product(string $code, string $name, int $stock, float $price, array $extra = []): Product
    {
        return Product::create($extra + [
            'code' => $code,
            'name' => $name,
            'category' => 'Products',
            'stock' => $stock,
            'price' => $price,
            'stock_status' => 'in_stock',
            'is_blocked' => false,
        ]);
    }

    private function actingAsRole(string $role): User
    {
        // SQLite retains the original role enum; authenticate Staff in memory.
        $user = User::factory()->create(['role' => $role === 'staff' ? 'admin' : $role]);
        $user->setAttribute('role', $role);
        Sanctum::actingAs($user);

        return $user;
    }

    private function filters(): array
    {
        return ['category' => 'product_inventory', 'period' => 'monthly', 'year' => 2026, 'month' => 4];
    }

    private function reportsUrl(array $overrides = []): string
    {
        return '/api/admin/reports?'.http_build_query($overrides + $this->filters());
    }
}
