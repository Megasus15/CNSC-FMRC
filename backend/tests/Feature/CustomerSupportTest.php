<?php

namespace Tests\Feature;

use App\Models\CustomerMessage;
use App\Models\User;
use App\Support\CustomerSupport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class CustomerSupportTest extends TestCase
{
    use RefreshDatabase;

    private function customer(): User
    {
        $user = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($user);
        return $user;
    }

    private function start(array $extra = []): array
    {
        return $this->postJson('/api/customer/messages', [...[
            'name' => 'A Customer', 'email' => 'customer@example.test', 'message' => "Hello\nSecond paragraph.",
            'request_key' => (string) Str::uuid(), 'source' => 'contact',
        ], ...$extra])->assertCreated()->json('data');
    }

    public function test_public_knowledge_is_bilingual_cacheable_and_contains_no_conversations(): void
    {
        $response = $this->getJson('/api/support/assistant')->assertOk()->assertJsonPath('data.installed', true);
        $response->assertJsonPath('data.config.name', 'FMRC Help');
        $this->assertGreaterThanOrEqual(16, count($response->json('data.faqs')));
        foreach ($response->json('data.faqs') as $faq) {
            $this->assertNotEmpty($faq['en']['answer']);
            $this->assertNotEmpty($faq['fil']['answer']);
        }
        $this->getJson('/api/support/assistant', ['If-None-Match' => $response->headers->get('ETag')])->assertStatus(304);
        $this->getJson('/api/customer/messages')->assertUnauthorized();
        $this->getJson('/api/support/availability')->assertOk()->assertJsonPath('available', false);
    }

    public function test_contact_and_widget_create_one_owned_thread_and_retry_does_not_duplicate_it(): void
    {
        $user = $this->customer();
        $key = (string) Str::uuid();
        $first = $this->start(['request_key' => $key]);
        $retry = $this->start(['request_key' => $key]);
        $this->assertSame($first['id'], $retry['id']);
        $this->assertDatabaseCount('customer_messages', 1);
        $this->assertDatabaseCount('customer_message_entries', 1);
        $this->assertDatabaseCount('admin_notifications', 1);
        $this->getJson('/api/customer/messages')->assertOk()->assertJsonPath('data.0.id', $first['id'])->assertJsonPath('unread_count', 0);
        $this->getJson('/api/customer/messages/'.$first['id'].'/entries')->assertOk()->assertJsonPath('data.0.body', "Hello\nSecond paragraph.");
        $this->assertDatabaseHas('customer_messages', ['id' => $first['id'], 'user_id' => $user->id, 'source' => 'contact']);
    }

    public function test_team_reply_read_cursors_and_explicit_customer_reopen_preserve_the_original(): void
    {
        $customer = $this->customer(); $root = $this->start(); $id = $root['id'];
        $staff = User::factory()->create(['role' => 'staff']); Sanctum::actingAs($staff);
        $key = (string) Str::uuid();
        $reply = ['body' => '<script>unsafe()</script> Plain text only.', 'request_key' => $key];
        $sent = $this->postJson("/api/admin/customer-messages/$id/entries", $reply)->assertOk();
        $entry = $sent->json('entry.id');
        $this->postJson("/api/admin/customer-messages/$id/entries", $reply)->assertOk()->assertJsonPath('entry.id', $entry);
        $this->getJson('/api/admin/customer-messages?search=Plain%20text&page=1')->assertOk()->assertJsonPath('data.0.id',$id);
        $this->assertDatabaseCount('customer_message_entries', 2);
        $this->assertDatabaseHas('customer_notifications', ['user_id' => $customer->id, 'type' => 'support', 'event_key' => 'support:'.$entry]);
        $this->patchJson("/api/admin/customer-messages/$id/resolve")->assertOk();
        Sanctum::actingAs($customer);
        $this->getJson("/api/customer/messages/$id/entries")->assertOk()->assertJsonPath('data.1.sender_name','FMRC Team');
        $this->getJson('/api/customer/messages')->assertOk()->assertJsonPath('unread_count', 1);
        $this->patchJson("/api/customer/messages/$id/read", ['through' => $entry])->assertOk();
        $this->getJson('/api/customer/messages')->assertJsonPath('unread_count', 0);
        $this->postJson("/api/customer/messages/$id/entries", ['body' => 'Blocked until reopened.', 'request_key' => (string) Str::uuid()])->assertStatus(409);
        $this->postJson("/api/customer/messages/$id/reopen")->assertOk()->assertJsonPath('data.status', 'new');
        $followup = $this->postJson("/api/customer/messages/$id/entries", ['body' => 'One follow-up.', 'request_key' => (string) Str::uuid()])->assertOk();
        $this->assertDatabaseHas('customer_messages', ['id' => $id, 'status' => 'new', 'is_read' => false, 'message' => "Hello\nSecond paragraph."]);
        // A stale cursor cannot mark a newer incoming message as read.
        Sanctum::actingAs($staff);
        $this->getJson("/api/admin/customer-messages/$id/entries")->assertOk()->assertJsonPath('data.1.sender_name',$staff->name);
        $this->patchJson("/api/admin/customer-messages/$id/conversation-read", ['through' => $entry])->assertOk();
        $this->assertDatabaseHas('customer_messages', ['id' => $id, 'is_read' => false]);
        $this->patchJson("/api/admin/customer-messages/$id/conversation-read", ['through' => $followup->json('entry.id')])->assertOk();
        $this->assertDatabaseHas('customer_messages', ['id' => $id, 'is_read' => true]);
    }

    public function test_customer_cannot_access_another_account_or_operator_routes(): void
    {
        $this->customer(); $root = $this->start(); $id = $root['id'];
        $this->customer();
        foreach (["/api/customer/messages/$id", "/api/customer/messages/$id/entries"] as $url) $this->getJson($url)->assertNotFound();
        $this->postJson("/api/customer/messages/$id/entries", ['body' => 'Intrusion', 'request_key' => (string) Str::uuid()])->assertNotFound();
        $this->patchJson("/api/customer/messages/$id/read", ['through' => 100])->assertNotFound();
        $this->getJson('/api/admin/customer-messages')->assertForbidden();
        $this->getJson("/api/admin/customer-messages/$id/entries")->assertForbidden();
        $this->getJson('/api/admin/support/assistant')->assertForbidden();
        $this->assertDatabaseCount('customer_message_entries', 1);
    }

    public function test_only_admin_can_save_validated_settings_and_stale_saves_keep_current_data(): void
    {
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $pack = $this->getJson('/api/admin/support/assistant')->assertOk()->json('data');
        $draft = ['revision' => $pack['revision'], 'config' => $pack['config'], 'faqs' => $pack['faqs']];
        $draft['config']['name'] = 'FMRC Support';
        $draft['faqs'][0]['en']['answer'] = "Edited answer.\nPreserved paragraph.";
        $draft['faqs'][1]['enabled'] = false;
        $this->putJson('/api/admin/support/assistant', $draft)->assertOk()->assertJsonPath('data.config.name', 'FMRC Support');
        $this->getJson('/api/admin/support/assistant')->assertJsonPath('data.faqs.0.en.answer', "Edited answer.\nPreserved paragraph.");
        $this->getJson('/api/support/assistant')->assertJsonMissing(['key' => $draft['faqs'][1]['key']]);
        $this->putJson('/api/admin/support/assistant', $draft)->assertStatus(409);
        $pack = $this->getJson('/api/admin/support/assistant')->json('data'); $draft['revision'] = $pack['revision'];
        $draft['config']['accent'] = '#ffff00';
        $this->putJson('/api/admin/support/assistant', $draft)->assertUnprocessable();
        $draft['config']['accent'] = '#6b202b'; $draft['config']['avatar'] = 'data:image/svg+xml;base64,PHN2Zz4=';
        $this->putJson('/api/admin/support/assistant', $draft)->assertUnprocessable();
        $draft['config']['avatar'] = ''; $draft['faqs'][0]['actions'] = ['javascript:alert(1)'];
        $this->putJson('/api/admin/support/assistant', $draft)->assertUnprocessable();
        $this->putJson('/api/admin/site-settings', ['support_assistant_config' => '{}'])->assertForbidden();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->getJson('/api/admin/support/assistant')->assertForbidden();
        $this->putJson('/api/admin/support/assistant', $draft)->assertForbidden();
        $this->putJson('/api/admin/site-settings', ['support_assistant_config' => '{}'])->assertForbidden();
        $this->getJson('/api/site-settings')->assertJsonMissingPath('data.support_assistant_config');
    }

    public function test_presence_expires_and_background_heartbeats_do_not_extend_the_session(): void
    {
        $staff = User::factory()->create(['role' => 'staff']);
        $issued = $staff->createToken('support-presence');
        $issued->accessToken->forceFill(['last_interaction_at' => now(), 'operator_session_max_hours' => 6])->save();
        $before = $issued->accessToken->last_interaction_at;
        $this->withToken($issued->plainTextToken)->postJson('/api/admin/customer-support/presence', ['available' => true])->assertOk()->assertJsonPath('available', true);
        $this->getJson('/api/support/availability')->assertJsonPath('available', true);
        $this->assertEquals($before, $issued->accessToken->fresh()->last_interaction_at);
        $this->travel(61)->seconds();
        $this->getJson('/api/support/availability')->assertJsonPath('available', false);
        $this->withToken($issued->plainTextToken)->postJson('/api/admin/customer-support/presence', ['available' => true])->assertOk();
        $issued->accessToken->forceFill(['last_interaction_at' => now()->subMinutes(64)])->save();
        // Availability also checks the authoritative idle deadline, not just the lease.
        $this->assertFalse(CustomerSupport::available());
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->getJson('/api/support/availability')->assertOk()->assertJsonPath('available', false);
    }

    public function test_entries_paginate_in_order_and_legacy_unowned_inquiries_are_not_claimed_by_email(): void
    {
        $this->customer(); $root = $this->start(); $id = $root['id'];
        $last = 0;
        for ($i = 0; $i < 57; $i++) $last = DB::table('customer_message_entries')->insertGetId(['customer_message_id' => $id,
            'sender_id' => null, 'sender_role' => 'staff', 'sender_name' => 'Team', 'body' => 'Reply '.$i, 'created_at' => now(), 'updated_at' => now()]);
        $page = $this->getJson("/api/customer/messages/$id/entries")->assertOk()->assertJsonCount(50, 'data')->assertJsonPath('has_more', true);
        $this->assertSame($last, $page->json('data.49.id'));
        $this->getJson("/api/customer/messages/$id/entries?before=".$page->json('data.0.id'))->assertJsonCount(8, 'data');
        $this->getJson("/api/customer/messages/$id/entries?after=".($last-2))->assertJsonCount(2, 'data');
        $this->getJson("/api/customer/messages/$id/entries?after=1&before=2")->assertUnprocessable();
        $legacy = CustomerMessage::create(['user_id' => null, 'sender_name' => 'Historical sender', 'sender_email' => 'customer@example.test', 'message' => 'Original', 'status' => 'new', 'is_read' => false]);
        $this->getJson('/api/customer/messages/'.$legacy->id)->assertNotFound();
        Sanctum::actingAs(User::factory()->create(['role' => 'admin']));
        $this->getJson('/api/admin/customer-messages/'.$legacy->id)->assertOk()->assertJsonPath('data.can_reply', false);
        $this->postJson('/api/admin/customer-messages/'.$legacy->id.'/entries', ['body' => 'No owner', 'request_key' => (string) Str::uuid()])->assertStatus(409);
    }

    public function test_deleting_a_conversation_removes_its_entries_and_missing_setup_keeps_contact_working(): void
    {
        $this->customer(); $root = $this->start();
        Sanctum::actingAs(User::factory()->create(['role' => 'staff']));
        $this->deleteJson('/api/admin/customer-messages/'.$root['id'])->assertOk();
        $this->assertDatabaseCount('customer_message_entries', 0);
        Schema::drop('customer_message_entries');
        $this->customer();
        $this->getJson('/api/customer/messages')->assertStatus(503);
        $this->getJson('/api/support/assistant')->assertOk()->assertJsonPath('data.installed', false);
        $this->start(['message' => 'Contact still works.']);
        $this->assertDatabaseHas('customer_messages', ['message' => 'Contact still works.']);
    }

    public function test_customer_end_is_idempotent_rejects_unseen_replies_and_keeps_history(): void
    {
        $customer = $this->customer(); $root = $this->start(); $id = $root['id']; $original = $root['last_entry_id'];
        $staff = User::factory()->create(['role' => 'staff']); Sanctum::actingAs($staff);
        $reply = $this->postJson("/api/admin/customer-messages/$id/entries", ['body' => 'An update.', 'request_key' => (string) Str::uuid()])->assertOk()->json('entry.id');
        Sanctum::actingAs($customer);
        $this->postJson("/api/customer/messages/$id/end", ['through' => $original])->assertStatus(409);
        $this->postJson("/api/customer/messages/$id/end", ['through' => $reply])->assertOk()->assertJsonPath('data.closed_by_role','customer');
        $this->postJson("/api/customer/messages/$id/end", ['through' => $reply])->assertOk();
        $this->assertDatabaseCount('customer_message_entries',3);
        $this->getJson("/api/customer/messages/$id/entries")->assertJsonPath('data.2.event','ended');
        $this->postJson("/api/customer/messages/$id/entries", ['body' => 'No automatic reopen.', 'request_key' => (string) Str::uuid()])->assertStatus(409);
        $this->postJson("/api/customer/messages/$id/reopen")->assertOk()->assertJsonPath('data.status','new');
        $this->postJson("/api/customer/messages/$id/reopen")->assertOk();
        $this->assertDatabaseCount('customer_message_entries',4);
        $this->getJson("/api/customer/messages/$id/entries")->assertJsonPath('data.3.event','reopened');
        Sanctum::actingAs($staff);
        $this->getJson('/api/admin/customer-messages?page=1&per_page=1')->assertOk()->assertJsonPath('meta.total',1)->assertJsonPath('eligible_ids.0',$id);
        $this->postJson("/api/customer/messages/$id/end", ['through' => 9999])->assertForbidden();
    }

    public function test_history_removal_only_affects_owned_ended_chats_and_bulk_recovers_from_skips(): void
    {
        $customer = $this->customer(); $active = $this->start(); $ended = $this->start();
        $this->deleteJson('/api/customer/messages/'.$active['id'].'/history')->assertStatus(409);
        $this->postJson('/api/customer/messages/'.$ended['id'].'/end',['through'=>$ended['last_entry_id']])->assertOk();
        $other = $this->customer(); $foreign = $this->start();
        $this->postJson('/api/customer/messages/'.$foreign['id'].'/end',['through'=>$foreign['last_entry_id']])->assertOk();
        Sanctum::actingAs($customer);
        $this->deleteJson('/api/customer/messages/'.$foreign['id'].'/history')->assertNotFound();
        $this->deleteJson('/api/customer/messages/history',['ids'=>[$active['id'],$ended['id'],$foreign['id']]])->assertOk()
            ->assertJsonPath('processed_ids.0',$ended['id'])->assertJsonCount(2,'skipped_ids');
        $this->getJson('/api/customer/messages')->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$active['id']);
        $this->getJson('/api/customer/messages/'.$ended['id'])->assertNotFound();
        $this->postJson('/api/customer/messages/'.$ended['id'].'/reopen')->assertNotFound();
        $this->assertDatabaseCount('customer_messages',3);
        $this->assertDatabaseCount('customer_message_entries',5);
        Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->getJson('/api/admin/customer-messages/'.$ended['id'])->assertOk()->assertJsonPath('data.removed_from_customer_history',true);
        $this->postJson('/api/admin/customer-messages/'.$ended['id'].'/reopen')->assertStatus(409);
        $this->deleteJson('/api/customer/messages/history',['ids'=>[$active['id']]])->assertForbidden();
    }

    public function test_additive_migration_keeps_historical_ownership_text_dates_and_resolved_state(): void
    {
        $migration = require database_path('migrations/2027_01_19_000000_add_customer_support_conversations.php');
        $migration->down();
        $owner = User::factory()->create(['role'=>'customer']);
        $id = DB::table('customer_messages')->insertGetId(['user_id'=>$owner->id,'sender_name'=>'Original sender',
            'sender_email'=>'original@example.test','message'=>"Original text.\n\nOriginal paragraphs.",'is_read'=>true,
            'status'=>'resolved','read_at'=>'2026-05-12 03:00:00','resolved_at'=>'2026-05-12 04:00:00',
            'created_at'=>'2026-05-11 03:00:00','updated_at'=>'2026-05-12 04:00:00']);
        $unowned = DB::table('customer_messages')->insertGetId(['user_id'=>null,'sender_name'=>'Unowned sender',
            'sender_email'=>$owner->email,'message'=>'Not assigned by an email match.','is_read'=>false,'status'=>'new',
            'created_at'=>'2026-05-11 04:00:00','updated_at'=>'2026-05-11 04:00:00']);
        $migration->up();
        $this->assertDatabaseHas('customer_messages',['id'=>$id,'status'=>'resolved','user_id'=>$owner->id,'updated_at'=>'2026-05-12 04:00:00']);
        $this->assertDatabaseHas('customer_message_entries',['customer_message_id'=>$id,'body'=>"Original text.\n\nOriginal paragraphs.",'created_at'=>'2026-05-11 03:00:00']);
        $this->assertDatabaseHas('customer_messages',['id'=>$unowned,'user_id'=>null]);
        Sanctum::actingAs($owner);
        $this->getJson('/api/customer/messages')->assertOk()->assertJsonCount(1,'data')->assertJsonPath('data.0.id',$id);
        $this->getJson('/api/customer/messages/'.$unowned)->assertNotFound();
    }
}
