<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\AdminAccounts;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class MultipleAdminsTest extends TestCase
{
    use RefreshDatabase;

    private function payload(string $name = 'second'): array
    {
        return ['name' => ucfirst($name).' Admin', 'username' => $name.'_admin', 'email' => $name.'.admin@gmail.com',
            'role' => 'admin', 'password' => 'SeparateAdmin123!', 'password_confirmation' => 'SeparateAdmin123!'];
    }

    public function test_every_full_admin_can_create_another_independent_full_admin(): void
    {
        Mail::fake();
        $first = User::factory()->create(['role' => 'admin']);
        Sanctum::actingAs($first);
        $secondId = $this->postJson('/api/users', $this->payload())->assertCreated()
            ->assertJsonPath('data.role', 'admin')->assertJsonMissingPath('data.password')->json('data.id');
        $second = User::findOrFail($secondId);
        $this->assertNotEquals($first->id, $secondId);
        $this->assertFalse($second->isSpectator());
        $this->assertTrue(Hash::check('SeparateAdmin123!', $second->password));
        Sanctum::actingAs($second);
        $this->postJson('/api/users', $this->payload('third'))->assertCreated();
        $this->getJson('/api/users')->assertOk()->assertJsonCount(3, 'data');
        $this->assertDatabaseCount('user_portal_preferences', 0);
        $this->assertDatabaseCount('admin_recovery_codes', 0);
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/login', ['login' => $second->username, 'password' => 'SeparateAdmin123!'])
            ->assertOk()->assertJsonPath('user.id', $secondId)->assertJsonPath('user.role', 'admin');
    }

    public function test_creation_validation_and_duplicate_requests_do_not_clone_accounts(): void
    {
        Mail::fake(); Sanctum::actingAs(User::factory()->create(['role'=>'admin']));
        $this->postJson('/api/users',$this->payload())->assertCreated();
        $this->postJson('/api/users',$this->payload())->assertUnprocessable()->assertJsonValidationErrors(['email','username']);
        $this->postJson('/api/users',[...$this->payload('invalid'),'password_confirmation'=>'different'])->assertUnprocessable();
        $this->assertDatabaseCount('users',2);
    }

    public function test_guests_other_roles_and_presentation_accounts_cannot_create_admins(): void
    {
        $this->postJson('/api/users',$this->payload())->assertUnauthorized();
        foreach (['staff','customer'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role'=>$role]));
            $this->postJson('/api/users',$this->payload())->assertForbidden();
        }
        $spectator=User::factory()->create(['role'=>'admin']);
        $spectator->forceFill(['is_spectator'=>true,'spectator_expires_at'=>now()->addHour()])->save();
        Sanctum::actingAs($spectator);
        $this->postJson('/api/users',$this->payload())->assertForbidden();
        $this->assertDatabaseMissing('users',['username'=>'second_admin']);
    }

    public function test_peer_deletion_revokes_only_the_target_and_protects_self_and_stale_actors(): void
    {
        $first=User::factory()->create(['role'=>'admin']); $second=User::factory()->create(['role'=>'admin']);
        $first->createToken('first'); $second->createToken('second');
        Sanctum::actingAs($second);
        $this->deleteJson('/api/users/'.$second->id)->assertUnprocessable();
        $users=$this->getJson('/api/users')->assertOk()->json('data');
        $this->assertFalse(collect($users)->firstWhere('id',$second->id)['can_delete']);
        $this->assertTrue(collect($users)->firstWhere('id',$first->id)['can_delete']);
        $this->deleteJson('/api/users/'.$first->id)->assertOk();
        $this->assertSoftDeleted('users',['id'=>$first->id]);
        $this->assertEquals(1,$second->tokens()->count());
        $this->assertDatabaseMissing('personal_access_tokens',['tokenable_id'=>$first->id]);
        // An action authenticated before a competing deletion must recheck the
        // actor under the roster lock, even if middleware previously accepted it.
        try { AdminAccounts::delete($first,[$second->id]); $this->fail('Deleted actor accepted'); }
        catch (HttpException $error) { $this->assertEquals(403,$error->getStatusCode()); }
        $this->assertDatabaseHas('users',['id'=>$second->id]);
    }

    public function test_bulk_delete_skips_self_and_does_not_treat_spectators_as_full_admins(): void
    {
        $first=User::factory()->create(['role'=>'admin']); $second=User::factory()->create(['role'=>'admin']);
        $spectator=User::factory()->create(['role'=>'admin']);
        $spectator->forceFill(['is_spectator'=>true,'spectator_expires_at'=>now()->addHour()])->save();
        Sanctum::actingAs($first);
        $this->deleteJson('/api/users/delete-bulk',['ids'=>[$first->id,$second->id,$spectator->id]])
            ->assertOk()->assertJsonPath('processed_count',2)->assertJsonPath('skipped_ids',[$first->id]);
        $this->deleteJson('/api/users/delete-bulk',['ids'=>[$first->id]])->assertNotFound();
        $this->assertEquals(1,User::where('role','admin')->count());
        $this->assertNotNull(AdminAccounts::deletionBlocker($first,$spectator,1));
    }

    public function test_new_admins_use_the_same_business_data_but_separate_preferences_and_recovery_codes(): void
    {
        Mail::fake();
        $a=User::factory()->create(['role'=>'admin','password'=>Hash::make('AdminOriginal123!')]);
        $b=User::factory()->create(['role'=>'admin','password'=>Hash::make('AdminSecond123!')]);
        Sanctum::actingAs($a);
        $this->putJson('/api/admin/preferences',['theme'=>'dark','compact'=>true,'reducedMotion'=>true])->assertOk();
        $this->putJson('/api/admin/site-settings',['about_heading'=>'Shared FMRC heading'])->assertOk();
        $codes=$this->postJson('/api/admin/recovery-codes/generate',['current_password'=>'AdminOriginal123!'])->assertOk()->json('codes');
        Sanctum::actingAs($b);
        $this->getJson('/api/admin/preferences')->assertOk()->assertJsonPath('preferences.theme','light');
        $this->getJson('/api/site-settings')->assertOk()->assertJsonPath('data.about_heading','Shared FMRC heading');
        $this->getJson('/api/admin/recovery-codes')->assertOk()->assertJsonPath('remaining',0);
        $this->putJson('/api/user',['username'=>'second_admin_updated'])->assertOk();
        $this->assertNotEquals('second_admin_updated',$a->fresh()->username);
        $this->assertDatabaseHas('users',['id'=>$b->id,'username'=>'second_admin_updated']);
        $this->assertEquals(10,DB::table('admin_recovery_codes')->where('user_id',$a->id)->count());
        $this->assertEquals(0,DB::table('admin_recovery_codes')->where('user_id',$b->id)->count());
        $this->assertTrue(Hash::check('AdminOriginal123!',$a->fresh()->password));
        $this->assertTrue(Hash::check('AdminSecond123!',$b->fresh()->password));
        $this->postJson('/api/forgot-password/recovery-code',['login'=>$b->fresh()->username,'recovery_code'=>$codes[0],
            'new_password'=>'UnpermittedReset123!','new_password_confirmation'=>'UnpermittedReset123!'])->assertUnprocessable();
        $this->assertEquals(10,DB::table('admin_recovery_codes')->where('user_id',$a->id)->whereNull('used_at')->count());
        $this->postJson('/api/change-password',['current_password'=>'AdminSecond123!','new_password'=>'ChangedSecond123!','new_password_confirmation'=>'ChangedSecond123!'])->assertOk();
        $this->assertTrue(Hash::check('AdminOriginal123!',$a->fresh()->password));
        $this->assertTrue(Hash::check('ChangedSecond123!',$b->fresh()->password));
    }

    public function test_bulk_failure_rolls_back_prior_deletions_and_token_revocations(): void
    {
        $actor=User::factory()->create(['role'=>'admin']);
        $a=User::factory()->create(['role'=>'admin']); $b=User::factory()->create(['role'=>'admin']);
        $a->createToken('a'); $b->createToken('b');
        User::deleting(function (User $target) use ($b) { if ($target->id===$b->id) throw new \RuntimeException('Injected deletion failure'); });
        try { AdminAccounts::delete($actor,[$a->id,$b->id],true); $this->fail('Expected failure'); }
        catch (\RuntimeException $error) { $this->assertEquals('Injected deletion failure',$error->getMessage()); }
        $this->assertDatabaseHas('users',['id'=>$a->id]); $this->assertDatabaseHas('users',['id'=>$b->id]);
        $this->assertEquals(1,$a->tokens()->count()); $this->assertEquals(1,$b->tokens()->count());
    }

    public function test_retained_agreement_no_longer_blocks_account_deletion_or_erases_its_history(): void
    {
        $actor=User::factory()->create(['role'=>'admin']); $peer=User::factory()->create(['role'=>'admin']);
        $customer=User::factory()->create(['role'=>'customer']);
        $job=DB::table('appointment_product_jobs')->insertGetId(['customer_id'=>$customer->id,'service_name'=>'Fixture service','request_key'=>'kept-agreement','requirements'=>'{}']);
        DB::table('appointment_product_messages')->insert(['job_id'=>$job,'sender_id'=>$peer->id,'sender_name'=>$peer->name,'sender_role'=>'admin','body'=>'A retained agreement note','request_key'=>'kept-note']);
        $peer->createToken('retained-peer'); Sanctum::actingAs($actor);
        $rows=$this->getJson('/api/users')->assertOk()->json('data');
        $this->assertTrue(collect($rows)->firstWhere('id',$peer->id)['can_delete']);
        $this->deleteJson('/api/users/'.$peer->id)->assertOk();
        $this->assertSoftDeleted('users',['id'=>$peer->id]);
        $this->assertEquals(0,$peer->tokens()->count());
        $this->assertDatabaseHas('appointment_product_messages',['job_id'=>$job,'sender_id'=>$peer->id]);
        $this->assertFalse(collect($this->getJson('/api/users')->assertOk()->json('data'))->contains('id',$peer->id));
    }
}
