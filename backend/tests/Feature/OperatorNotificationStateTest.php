<?php

namespace Tests\Feature;

use App\Models\AdminNotification;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class OperatorNotificationStateTest extends TestCase
{
    use RefreshDatabase;

    private function event(array $extra=[]): AdminNotification
    {
        return AdminNotification::create([...['type'=>'order','title'=>'Shared event','message'=>'Order requires review.','is_read'=>false],...$extra]);
    }

    public function test_each_admin_and_staff_reads_and_clears_only_their_own_feed(): void
    {
        $event=$this->event(); $operators=[];
        foreach (['admin','admin','staff','staff'] as $role) $operators[]=User::factory()->create(['role'=>$role]);
        foreach ($operators as $index=>$user) {
            Sanctum::actingAs($user);
            $this->getJson('/api/admin/notifications')->assertOk()->assertJsonPath('user_id',$user->id)->assertJsonPath('unread_count',1);
            $this->patchJson('/api/admin/notifications/'.$event->id.'/read')->assertOk()->assertJsonPath('user_id',$user->id);
            $this->getJson('/api/admin/notifications')->assertOk()->assertJsonPath('data.0.is_read',true)->assertJsonPath('unread_count',0);
            $this->deleteJson('/api/admin/notifications/'.$event->id)->assertOk();
            $this->getJson('/api/admin/notifications')->assertOk()->assertJsonCount(0,'data');
            $this->assertDatabaseHas('admin_notifications',['id'=>$event->id,'is_read'=>false]);
        }
        $this->assertDatabaseCount('admin_notification_states',4);
    }

    public function test_historical_baseline_and_unread_counts_cover_more_than_the_latest_fifty(): void
    {
        $old=$this->event(['is_read'=>true]);
        for($i=0;$i<61;$i++) $this->event();
        foreach (['admin','staff'] as $role) {
            $user=User::factory()->create(['role'=>$role]); Sanctum::actingAs($user);
            $this->getJson('/api/admin/notifications')->assertOk()->assertJsonCount(50,'data')->assertJsonPath('unread_count',61);
            $this->getJson('/api/admin/notifications/unread-count')->assertOk()->assertJsonPath('unread_count',61);
            $this->postJson('/api/admin/notifications/mark-all-read')->assertOk();
            $this->getJson('/api/admin/notifications/unread-count')->assertOk()->assertJsonPath('unread_count',0);
        }
        $this->assertDatabaseHas('admin_notifications',['id'=>$old->id,'is_read'=>true]);
        $this->assertEquals(61,AdminNotification::where('is_read',false)->count());
    }

    public function test_clear_and_mark_all_do_not_consume_new_arrivals_or_another_accounts_events(): void
    {
        $a=User::factory()->create(['role'=>'admin']); $b=User::factory()->create(['role'=>'staff']);
        $first=$this->event(); Sanctum::actingAs($a);
        $this->postJson('/api/admin/notifications/mark-all-read')->assertOk();
        $second=$this->event();
        $this->getJson('/api/admin/notifications/unread-count')->assertOk()->assertJsonPath('unread_count',1);
        $this->deleteJson('/api/admin/notifications/clear-all')->assertOk();
        $third=$this->event();
        $this->getJson('/api/admin/notifications')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$third->id);
        Sanctum::actingAs($b);
        $this->getJson('/api/admin/notifications/unread-count')->assertOk()->assertJsonPath('unread_count',3);
        $this->assertDatabaseCount('admin_notifications',3);
    }

    public function test_role_restrictions_and_missing_migration_never_mutate_shared_rows(): void
    {
        $adminOnly=$this->event(['type'=>'account_request']); $ordinary=$this->event();
        $this->getJson('/api/admin/notifications')->assertUnauthorized();
        Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->getJson('/api/admin/notifications')->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $this->patchJson('/api/admin/notifications/'.$adminOnly->id.'/read')->assertNotFound();
        $this->deleteJson('/api/admin/notifications/'.$adminOnly->id)->assertNotFound();
        $this->deleteJson('/api/admin/notifications/clear-all')->assertOk();
        $this->assertDatabaseCount('admin_notifications',2);
        $this->assertDatabaseMissing('admin_notification_states',['notification_id'=>$adminOnly->id]);
        Schema::drop('admin_notification_states');
        $this->getJson('/api/admin/notifications')->assertStatus(503);
        $this->postJson('/api/admin/notifications/mark-all-read')->assertStatus(503);
        $this->deleteJson('/api/admin/notifications/'.$ordinary->id)->assertStatus(503);
        $this->assertDatabaseCount('admin_notifications',2);
    }

    public function test_an_event_arriving_during_clear_all_is_outside_its_snapshot(): void
    {
        $this->event(); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $arrived=null;
        DB::listen(function ($query) use (&$arrived) {
            if (!$arrived && preg_match('/insert.*admin_notification_states/i',$query->sql)) $arrived=$this->event(['title'=>'Arrived during clearing']);
        });
        $this->deleteJson('/api/admin/notifications/clear-all')->assertOk();
        $this->assertNotNull($arrived);
        $this->getJson('/api/admin/notifications')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$arrived->id)->assertJsonPath('unread_count',1);
    }
}
