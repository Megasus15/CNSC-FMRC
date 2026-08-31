<?php

namespace Tests\Feature;

use App\Mail\StaffAccountRequestApproved;
use App\Mail\StaffAccountRequestRejected;
use App\Models\AdminNotification;
use App\Models\StaffAccountRequest;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * The staff-account application flow: public submission, admin decision.
 *
 * Two properties matter more than any single endpoint and are asserted
 * repeatedly below:
 *
 *  1. The applicant's password exists only as a bcrypt hash, is never returned by
 *     any endpoint, is never emailed, and is erased the moment a decision is made.
 *  2. Approving a request must leave the applicant able to sign in with the
 *     password they originally typed -- moving the stored hash into `users` is
 *     only correct because the `hashed` cast passes an existing hash through.
 */
class StaffAccountRequestTest extends TestCase
{
    use RefreshDatabase;

    private const APPLICANT_PASSWORD = 'ApplicantPass!2026';

    protected function setUp(): void
    {
        parent::setUp();

        // The controller memoises its table probe, and RefreshDatabase rebuilds
        // the schema between tests.
        StaffAccountRequest::forgetTableReady();
        RateLimiter::clear('staff-account-request:' . sha1('127.0.0.1'));
    }

    /** The payload the modal sends, with any field overridden. */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Juan Dela Cruz',
            'username' => 'juandc',
            'email' => 'juan.delacruz.fmrc@gmail.com',
            'password' => self::APPLICANT_PASSWORD,
            'password_confirmation' => self::APPLICANT_PASSWORD,
        ], $overrides);
    }

    private function admin(): User
    {
        return User::factory()->create([
            'name' => 'Site Administrator',
            'username' => 'admin',
            'email' => 'site.admin.fmrc@gmail.com',
            'role' => 'admin',
            'password' => Hash::make('AdminPass!2026'),
        ]);
    }

    /** Submit one application and return the stored row. */
    private function submit(array $overrides = []): StaffAccountRequest
    {
        $this->postJson('/api/staff-account-requests', $this->payload($overrides))
            ->assertCreated();

        return StaffAccountRequest::query()->latest('id')->firstOrFail();
    }

    public function test_a_valid_submission_stores_a_pending_row_with_only_a_hash(): void
    {
        Mail::fake();

        $this->postJson('/api/staff-account-requests', $this->payload())
            ->assertCreated()
            ->assertJsonPath('installed', true)
            ->assertJsonPath(
                'message',
                'Your request has been submitted. An administrator will review it and email you the decision.',
            );

        $row = StaffAccountRequest::query()->firstOrFail();

        $this->assertSame(StaffAccountRequest::STATUS_PENDING, $row->status);
        $this->assertSame('juan.delacruz.fmrc@gmail.com', $row->email);
        $this->assertNotSame(self::APPLICANT_PASSWORD, $row->password_hash);
        $this->assertTrue(Hash::check(self::APPLICANT_PASSWORD, (string) $row->password_hash));
        // No account exists until an administrator approves.
        $this->assertDatabaseCount('users', 0);
    }

    public function test_a_submission_raises_one_admin_notification_that_points_at_the_row(): void
    {
        Mail::fake();

        $row = $this->submit();

        $this->assertDatabaseCount('admin_notifications', 1);

        $notification = AdminNotification::query()->firstOrFail();

        $this->assertSame('account_request', $notification->type);
        $this->assertSame('New staff account request', $notification->title);
        $this->assertStringContainsString('juan.delacruz.fmrc@gmail.com', (string) $notification->message);
        $this->assertSame($row->id, (int) ($notification->metadata['staff_account_request_id'] ?? 0));
        $this->assertFalse((bool) $notification->is_read);
    }

    public function test_a_non_gmail_address_is_refused(): void
    {
        Mail::fake();

        $this->postJson('/api/staff-account-requests', $this->payload(['email' => 'juan@yahoo.com']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email']);

        $this->assertDatabaseCount('staff_account_requests', 0);
    }

    public function test_a_mismatched_password_confirmation_is_refused(): void
    {
        Mail::fake();

        $this->postJson('/api/staff-account-requests', $this->payload([
            'password_confirmation' => 'SomethingElse!2026',
        ]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['password']);

        $this->assertDatabaseCount('staff_account_requests', 0);
    }

    public function test_an_email_or_username_already_owned_by_an_account_is_refused(): void
    {
        Mail::fake();

        User::factory()->create([
            'username' => 'takenname',
            'email' => 'already.staff.fmrc@gmail.com',
            'role' => 'staff',
        ]);

        $this->postJson('/api/staff-account-requests', $this->payload([
            'email' => 'already.staff.fmrc@gmail.com',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['email']);

        $this->postJson('/api/staff-account-requests', $this->payload([
            'username' => 'takenname',
        ]))->assertUnprocessable()->assertJsonValidationErrors(['username']);

        $this->assertDatabaseCount('staff_account_requests', 0);
    }

    public function test_a_second_request_while_one_is_pending_is_refused_but_a_rejected_one_may_reapply(): void
    {
        Mail::fake();

        $first = $this->submit();

        $this->postJson('/api/staff-account-requests', $this->payload())
            ->assertUnprocessable()
            ->assertJsonPath('message', 'You already have a request waiting for review.')
            ->assertJsonValidationErrors(['email', 'username']);

        $this->assertDatabaseCount('staff_account_requests', 1);

        // Once the pending row has been decided the same person may try again --
        // which is exactly why `email` carries no unique index.
        $first->update([
            'status' => StaffAccountRequest::STATUS_REJECTED,
            'password_hash' => null,
        ]);

        $this->postJson('/api/staff-account-requests', $this->payload())->assertCreated();

        $this->assertDatabaseCount('staff_account_requests', 2);
    }

    public function test_the_sixth_submission_from_one_address_within_the_hour_is_throttled(): void
    {
        Mail::fake();

        for ($i = 1; $i <= 5; $i++) {
            $this->postJson('/api/staff-account-requests', $this->payload([
                'username' => 'applicant' . $i,
                'email' => "applicant{$i}.fmrc@gmail.com",
            ]))->assertCreated();
        }

        $response = $this->postJson('/api/staff-account-requests', $this->payload([
            'username' => 'applicant6',
            'email' => 'applicant6.fmrc@gmail.com',
        ]))->assertStatus(429);

        $this->assertGreaterThan(0, (int) $response->json('retry_after_seconds'));
        $this->assertDatabaseCount('staff_account_requests', 5);
    }

    public function test_a_validation_failure_does_not_spend_the_hourly_allowance(): void
    {
        Mail::fake();

        // Ten rejected attempts, then five good ones still all succeed: only a
        // submission that actually creates a row is counted.
        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/staff-account-requests', $this->payload(['email' => 'nope@yahoo.com']))
                ->assertUnprocessable();
        }

        for ($i = 1; $i <= 5; $i++) {
            $this->postJson('/api/staff-account-requests', $this->payload([
                'username' => 'good' . $i,
                'email' => "good{$i}.fmrc@gmail.com",
            ]))->assertCreated();
        }
    }

    public function test_the_queue_lists_pending_rows_first_and_never_leaks_the_hash(): void
    {
        Mail::fake();

        $pending = $this->submit();
        $decided = $this->submit(['username' => 'olderone', 'email' => 'older.one.fmrc@gmail.com']);
        $decided->update([
            'status' => StaffAccountRequest::STATUS_REJECTED,
            'password_hash' => null,
            'reviewed_at' => now(),
        ]);

        Sanctum::actingAs($this->admin());

        $response = $this->getJson('/api/admin/staff-account-requests')
            ->assertOk()
            ->assertJsonPath('installed', true)
            ->assertJsonPath('counts.pending', 1)
            ->assertJsonPath('counts.rejected', 1)
            ->assertJsonPath('counts.total', 2);

        $rows = $response->json('data');

        $this->assertCount(2, $rows);
        $this->assertSame($pending->id, $rows[0]['id'], 'Pending rows must sort first.');
        $this->assertArrayNotHasKey('password_hash', $rows[0]);

        // The status filter the panel's <select> sends.
        $this->getJson('/api/admin/staff-account-requests?status=rejected')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $decided->id);
    }

    public function test_approving_creates_a_staff_account_the_applicant_can_sign_in_to(): void
    {
        Mail::fake();

        $row = $this->submit();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")
            ->assertOk()
            ->assertJsonPath('message', 'Staff account approved successfully.')
            ->assertJsonPath('data.status', StaffAccountRequest::STATUS_APPROVED)
            ->assertJsonPath('user.role', 'staff')
            ->assertJsonPath('user.username', 'juandc');

        $created = User::query()->where('email', 'juan.delacruz.fmrc@gmail.com')->firstOrFail();
        $this->assertSame('staff', $created->role);

        $row->refresh();
        $this->assertSame(StaffAccountRequest::STATUS_APPROVED, $row->status);
        $this->assertNull($row->password_hash, 'A decided request must not keep a usable credential.');
        $this->assertSame($admin->id, (int) $row->reviewed_by);
        $this->assertSame($created->id, (int) $row->created_user_id);
        $this->assertNotNull($row->reviewed_at);

        // The whole point: the password the applicant typed still works, because
        // the `hashed` cast passes an already-hashed value straight through.
        $this->postJson('/api/login', [
            'login' => 'juandc',
            'password' => self::APPLICANT_PASSWORD,
        ])->assertOk();

        Mail::assertSent(StaffAccountRequestApproved::class, function ($mail) {
            return $mail->hasTo('juan.delacruz.fmrc@gmail.com');
        });
        Mail::assertNotSent(StaffAccountRequestRejected::class);
    }

    public function test_rejecting_with_a_reason_emails_it_and_creates_no_account(): void
    {
        Mail::fake();

        $row = $this->submit();
        $admin = $this->admin();
        Sanctum::actingAs($admin);

        $reason = 'We could not confirm your affiliation with the laboratory. Please visit the office first.';

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject", ['note' => $reason])
            ->assertOk()
            ->assertJsonPath('message', 'Account request rejected.')
            ->assertJsonPath('data.status', StaffAccountRequest::STATUS_REJECTED)
            ->assertJsonPath('data.decision_note', $reason);

        $row->refresh();
        $this->assertNull($row->password_hash);
        $this->assertSame($reason, $row->decision_note);
        $this->assertSame($admin->id, (int) $row->reviewed_by);

        // Only the admin account exists; the applicant never got one.
        $this->assertDatabaseCount('users', 1);
        $this->assertDatabaseMissing('users', ['email' => 'juan.delacruz.fmrc@gmail.com']);

        Mail::assertSent(StaffAccountRequestRejected::class, function ($mail) use ($reason) {
            return $mail->hasTo('juan.delacruz.fmrc@gmail.com')
                && str_contains($mail->render(), e($reason));
        });
        Mail::assertNotSent(StaffAccountRequestApproved::class);
    }

    public function test_rejecting_without_a_reason_still_emails_the_applicant(): void
    {
        Mail::fake();

        $row = $this->submit();
        Sanctum::actingAs($this->admin());

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject")
            ->assertOk()
            ->assertJsonPath('data.decision_note', null);

        $this->assertNull($row->fresh()?->decision_note);

        Mail::assertSent(StaffAccountRequestRejected::class, function ($mail) {
            $html = $mail->render();

            return $mail->hasTo('juan.delacruz.fmrc@gmail.com')
                // No empty "Note From the Administrator" card when there is no note.
                && !str_contains($html, 'Note From the Administrator');
        });
    }

    public function test_a_reason_longer_than_three_hundred_characters_is_refused(): void
    {
        Mail::fake();

        $row = $this->submit();
        Sanctum::actingAs($this->admin());

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject", [
            'note' => str_repeat('x', 301),
        ])->assertUnprocessable()->assertJsonValidationErrors(['note']);

        $this->assertSame(StaffAccountRequest::STATUS_PENDING, $row->fresh()?->status);
    }

    public function test_neither_decision_email_ever_contains_the_password(): void
    {
        Mail::fake();

        $approved = $this->submit();
        $rejected = $this->submit(['username' => 'seconduser', 'email' => 'second.user.fmrc@gmail.com']);

        Sanctum::actingAs($this->admin());
        $this->postJson("/api/admin/staff-account-requests/{$approved->id}/approve")->assertOk();
        $this->postJson("/api/admin/staff-account-requests/{$rejected->id}/reject")->assertOk();

        foreach ([StaffAccountRequestApproved::class, StaffAccountRequestRejected::class] as $mailable) {
            Mail::assertSent($mailable, function ($mail) {
                return !str_contains($mail->render(), self::APPLICANT_PASSWORD);
            });
        }
    }

    public function test_a_decided_request_cannot_be_decided_again(): void
    {
        Mail::fake();

        $row = $this->submit();
        Sanctum::actingAs($this->admin());

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")->assertOk();

        // The double-click, and the second admin looking at a stale page.
        $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")
            ->assertStatus(409)
            ->assertJsonPath('status', StaffAccountRequest::STATUS_APPROVED);

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject")
            ->assertStatus(409);

        $this->assertDatabaseCount('users', 2);
    }

    public function test_approving_a_request_whose_gmail_was_claimed_meanwhile_returns_409(): void
    {
        Mail::fake();

        $row = $this->submit();

        // Somebody registered with the same Gmail while the request waited.
        User::factory()->create([
            'username' => 'someoneelse',
            'email' => 'juan.delacruz.fmrc@gmail.com',
            'role' => 'customer',
        ]);

        Sanctum::actingAs($this->admin());

        $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")
            ->assertStatus(409)
            ->assertJsonPath('status', StaffAccountRequest::STATUS_PENDING);

        // Nothing was created and nothing was decided, so the admin can still
        // reject the row and tell the applicant why.
        $this->assertSame(StaffAccountRequest::STATUS_PENDING, $row->fresh()?->status);
        $this->assertSame(2, User::query()->count());
        Mail::assertNothingSent();
    }

    public function test_a_missing_request_id_answers_404(): void
    {
        Mail::fake();
        Sanctum::actingAs($this->admin());

        $this->postJson('/api/admin/staff-account-requests/98765/approve')->assertNotFound();
        $this->postJson('/api/admin/staff-account-requests/98765/reject')->assertNotFound();
    }

    public function test_staff_and_customer_tokens_are_forbidden_on_every_admin_endpoint(): void
    {
        Mail::fake();

        $row = $this->submit();

        foreach (['staff', 'customer'] as $role) {
            $actor = User::factory()->create([
                'username' => $role . 'actor',
                'email' => $role . '.actor.fmrc@gmail.com',
                'role' => $role,
            ]);

            Sanctum::actingAs($actor);

            $this->getJson('/api/admin/staff-account-requests')
                ->assertForbidden()
                ->assertJsonPath('message', 'Forbidden. Admin access is required.');
            $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")->assertForbidden();
            $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject")->assertForbidden();
        }

        // Nothing was decided and no staff account was created by either actor.
        $this->assertSame(StaffAccountRequest::STATUS_PENDING, $row->fresh()?->status);
        $this->assertDatabaseMissing('users', ['email' => 'juan.delacruz.fmrc@gmail.com']);
        Mail::assertNothingSent();
    }

    public function test_a_guest_cannot_reach_the_admin_endpoints(): void
    {
        Mail::fake();

        $row = $this->submit();

        $this->getJson('/api/admin/staff-account-requests')->assertUnauthorized();
        $this->postJson("/api/admin/staff-account-requests/{$row->id}/approve")->assertUnauthorized();
        $this->postJson("/api/admin/staff-account-requests/{$row->id}/reject")->assertUnauthorized();
    }

    /**
     * The notification the submission raises is addressed to administrators: it names
     * the applicant and their Gmail, and the only page that can answer it lives in the
     * Admin portal. A staff session shares the same bell endpoint, so the scope has to
     * hold on the feed, on both unread counters, and on the two endpoints that take an
     * id -- otherwise the badge would keep counting a row the feed no longer lists.
     */
    public function test_the_bell_hides_account_requests_from_a_staff_session(): void
    {
        Mail::fake();

        $this->submit();
        $accountRequest = AdminNotification::query()->firstOrFail();

        $ordinary = AdminNotification::query()->create([
            'type' => 'order',
            'title' => 'New order received',
            'message' => 'Order #1 is waiting for review.',
        ]);

        Sanctum::actingAs(User::factory()->create([
            'username' => 'staffbell',
            'email' => 'staff.bell.fmrc@gmail.com',
            'role' => 'staff',
        ]));

        $this->getJson('/api/admin/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ordinary->id)
            ->assertJsonPath('unread_count', 1)
            ->assertJsonMissing(['type' => 'account_request'])
            ->assertDontSee('juan.delacruz.fmrc@gmail.com');

        $this->getJson('/api/admin/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('unread_count', 1);

        // An id guessed from outside the feed is answered as if it did not exist.
        $this->patchJson("/api/admin/notifications/{$accountRequest->id}/read")->assertNotFound();
        $this->deleteJson("/api/admin/notifications/{$accountRequest->id}")->assertNotFound();

        // Clearing or reading "all" only reaches what that session can see.
        $this->postJson('/api/admin/notifications/mark-all-read')->assertOk();
        $this->deleteJson('/api/admin/notifications/clear-all')->assertOk();

        $this->assertDatabaseHas('admin_notifications', [
            'id' => $accountRequest->id,
            'is_read' => false,
        ]);
        $this->assertDatabaseMissing('admin_notifications', ['id' => $ordinary->id]);
    }

    public function test_the_bell_still_shows_account_requests_to_an_administrator(): void
    {
        Mail::fake();

        $this->submit();

        Sanctum::actingAs($this->admin());

        $this->getJson('/api/admin/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'account_request')
            ->assertJsonPath('unread_count', 1);

        $this->getJson('/api/admin/notifications/unread-count')
            ->assertOk()
            ->assertJsonPath('unread_count', 1);

        $id = (int) AdminNotification::query()->value('id');

        $this->patchJson("/api/admin/notifications/{$id}/read")->assertOk();
        $this->assertDatabaseHas('admin_notifications', ['id' => $id, 'is_read' => true]);

        $this->deleteJson("/api/admin/notifications/{$id}")->assertOk();
        $this->assertDatabaseCount('admin_notifications', 0);
    }
}
