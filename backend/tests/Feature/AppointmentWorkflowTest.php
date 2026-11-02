<?php

namespace Tests\Feature;

use App\Mail\AppointmentConfirmation;
use App\Models\Appointment;
use App\Models\AppointmentCalendarDay;
use App\Models\AppointmentTimeSlot;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AppointmentWorkflowTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-02 08:00:00', 'Asia/Manila')->utc());
        Mail::fake();
        Storage::fake('local');
        Storage::fake('public');
        config(['services.turnstile.enabled' => false]);
        $this->owner = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($this->owner);
        foreach ([['9:00 - 10:00 AM', 'AM'], ['10:00 - 11:00 AM', 'AM'], ['1:00 - 2:00 PM', 'PM']] as $index => $slot) {
            AppointmentTimeSlot::create(['label' => $slot[0], 'type' => $slot[1], 'sort_order' => $index + 1, 'is_active' => true]);
        }
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function body(array $extra = []): array
    {
        return array_merge(['first_name' => 'Maria', 'last_name' => 'Santos', 'contact_number' => '09171234567', 'email' => 'maria@gmail.com', 'country' => 'Philippines', 'full_address' => 'Daet, Camarines Norte', 'client_type' => 'Student', 'purpose' => '3D Printing', 'appointment_method' => 'online', 'appointment_date' => '2026-11-03', 'appointment_time' => '9:00 - 10:00 AM'], $extra);
    }

    private function appointment(array $extra = []): Appointment
    {
        return Appointment::create(array_merge($this->body(), ['user_id' => $this->owner->id, 'reference_no' => 'AP-WORKFLOW', 'status' => 'Scheduled'], $extra));
    }

    private function move(Appointment $item, array $extra = []): array
    {
        return array_merge(['appointment_date' => '2026-11-04', 'appointment_time' => '10:00 - 11:00 AM', 'expected_date' => $item->appointment_date->format('Y-m-d'), 'expected_time' => $item->appointment_time, 'expected_version' => (int) $item->schedule_version], $extra);
    }

    private function operator(string $role = 'admin'): User
    {
        $user = User::factory()->create(['role' => 'admin']);
        $user->role = $role;
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_booking_stores_method_and_multiple_private_cad_files_without_public_urls(): void
    {
        $response = $this->post('/api/appointments', $this->body(['attachments' => [UploadedFile::fake()->create('part.step', 10, 'application/octet-stream'), UploadedFile::fake()->create('drawing.dxf', 12, 'application/octet-stream')]]), ['Accept' => 'application/json'])->assertCreated()->assertJsonPath('data.method_label', 'Online')->assertJsonPath('data.meeting_status', 'Meeting link pending')->assertJsonCount(2, 'data.attachments');
        $id = $response->json('data.id');
        $record = DB::table('appointment_attachments')->first();
        Storage::disk('local')->assertExists($record->path);
        Storage::disk('public')->assertMissing($record->path);
        $this->assertStringNotContainsString('/storage/', $response->getContent());
        $this->getJson('/api/customer/appointments')->assertJsonPath('data.0.id', $id);
        Mail::assertSent(AppointmentConfirmation::class, fn ($mail) => str_contains($mail->render(), 'Meeting link pending'));
    }

    public function test_customer_list_places_new_bookings_before_older_bookings_with_later_schedules(): void
    {
        $newer = $this->appointment(['reference_no' => 'AP-NEWER', 'appointment_date' => '2026-11-03']);
        $newer->forceFill(['created_at' => now()->subDay()])->save();
        $older = $this->appointment(['reference_no' => 'AP-OLDER', 'appointment_date' => '2026-12-01']);
        $older->forceFill(['created_at' => now()->subDays(2)])->save();
        $latest = $this->appointment(['reference_no' => 'AP-LATEST', 'appointment_date' => '2026-11-04']);
        $latest->forceFill(['created_at' => now()->subDay()])->save();
        $this->appointment(['reference_no' => 'AP-OTHER', 'user_id' => User::factory()->create(['role' => 'customer'])->id]);

        $this->getJson('/api/customer/appointments')->assertOk()->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.id', $latest->id)->assertJsonPath('data.1.id', $newer->id)->assertJsonPath('data.2.id', $older->id);
    }

    public function test_file_downloads_require_owner_or_operator_and_public_verification_excludes_private_data(): void
    {
        $item = $this->appointment(['meeting_platform' => 'Google Meet', 'meeting_url' => 'https://meet.google.com/private']);
        Storage::disk('local')->put('appointment-attachments/design.step', 'ISO-10303-21;');
        $file = DB::table('appointment_attachments')->insertGetId(['appointment_id' => $item->id, 'name' => 'design.step', 'path' => 'appointment-attachments/design.step', 'mime' => 'application/octet-stream', 'size' => 13, 'created_at' => now()]);
        $path = '/api/customer/appointments/'.$item->id.'/attachments/'.$file;
        $this->get($path)->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff')->assertHeader('Content-Type', 'application/octet-stream');
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->get($path)->assertNotFound();
        $this->getJson('/api/customer/appointments/'.$item->id)->assertNotFound();
        $this->getJson('/api/appointments')->assertForbidden();
        $this->operator('staff');
        $this->get($path)->assertOk();
        $public = $this->getJson('/api/appointments/'.$item->reference_no.'/verify')->assertOk();
        $this->assertArrayNotHasKey('attachments', $public->json('data'));
        $this->assertArrayNotHasKey('meeting_url', $public->json('data'));
        $this->assertStringNotContainsString('private', $public->getContent());
        $this->get('/appointments/verify/'.$item->reference_no)->assertOk()->assertDontSee('meet.google.com')->assertDontSee('design.step');
    }

    public function test_legacy_files_remain_authorized_but_guest_email_never_grants_account_ownership(): void
    {
        $item = $this->appointment(['user_id' => null, 'email' => $this->owner->email, 'attachment_name' => 'old.pdf', 'attachment_path' => 'old.pdf']);
        Storage::disk('public')->put('old.pdf', 'legacy');
        $this->get('/api/customer/appointments/'.$item->id.'/attachments/legacy')->assertNotFound();
        $this->getJson('/api/customer/appointments')->assertJsonCount(0, 'data');
        $this->operator();
        $this->get('/api/customer/appointments/'.$item->id.'/attachments/legacy')->assertOk();
    }

    public function test_upload_count_total_and_disallowed_extensions_are_rejected_without_records(): void
    {
        $files = array_map(fn ($n) => UploadedFile::fake()->create('design'.$n.'.obj', 1, 'text/plain'), range(1, 6));
        $this->post('/api/appointments', $this->body(['attachments' => $files]), ['Accept' => 'application/json'])->assertUnprocessable();
        $this->post('/api/appointments', $this->body(['attachments' => [UploadedFile::fake()->create('a.stl', 30000), UploadedFile::fake()->create('b.stl', 22000)]]), ['Accept' => 'application/json'])->assertUnprocessable();
        $this->post('/api/appointments', $this->body(['attachments' => [UploadedFile::fake()->create('script.html', 1, 'text/html')]]), ['Accept' => 'application/json'])->assertUnprocessable();
        $this->post('/api/appointments', $this->body(['attachments' => [UploadedFile::fake()->createWithContent('fake.obj', '<?php echo 1;')]]), ['Accept' => 'application/json'])->assertUnprocessable();
        $this->assertDatabaseCount('appointments', 0);
        $this->assertCount(0, Storage::disk('local')->allFiles());
    }

    public function test_rescheduling_is_immediate_and_clears_meeting_details_records_history_and_updates_receipt_notifications(): void
    {
        $item = $this->appointment(['meeting_platform' => 'Zoom', 'meeting_url' => 'https://zoom.us/j/old']);
        $notifications = DB::table('customer_notifications')->count();
        $data = $this->move($item);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $data)->assertOk()->assertJsonPath('data.appointment_date', '2026-11-04')->assertJsonPath('data.schedule_version', 1)->assertJsonPath('data.meeting_url', null)->assertJsonPath('data.meeting_status', 'Meeting link pending')->assertJsonCount(1, 'data.schedule_history');
        $this->assertDatabaseHas('appointment_schedule_history', ['appointment_id' => $item->id, 'previous_date' => '2026-11-03', 'actor_id' => $this->owner->id]);
        $this->assertGreaterThan($notifications, DB::table('customer_notifications')->count());
        $this->assertDatabaseHas('admin_notifications', ['title' => 'Appointment rescheduled: AP-WORKFLOW']);
        $this->get('/appointments/verify/'.$item->reference_no)->assertSee('2026-11-04')->assertDontSee('zoom.us');
        Mail::assertSent(AppointmentConfirmation::class, fn ($mail) => $mail->updated && str_contains($mail->render(), '2026-11-04'));
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $data)->assertConflict();
        $this->assertDatabaseCount('appointment_schedule_history', 1);
    }

    public function test_other_customer_cannot_reschedule_and_original_cutoff_uses_manila_exact_start(): void
    {
        $item = $this->appointment(['appointment_date' => '2026-11-02']);
        Sanctum::actingAs(User::factory()->create(['role' => 'customer']));
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertNotFound();
        Sanctum::actingAs($this->owner);
        Carbon::setTestNow(Carbon::parse('2026-11-02 01:00:00', 'UTC'));
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertUnprocessable();
        $this->assertDatabaseCount('appointment_schedule_history', 0);
    }

    public function test_booking_and_rescheduling_share_weekend_blocked_custom_and_overlap_restrictions(): void
    {
        $item = $this->appointment();
        $target = '2026-11-04';
        AppointmentCalendarDay::create(['date' => $target, 'is_blocked' => true]);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertUnprocessable();
        AppointmentCalendarDay::whereDate('date', $target)->update(['is_blocked' => false, 'blocked_slots' => json_encode(['10:00 - 11:00 AM'])]);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertUnprocessable();
        $this->postJson('/api/appointments', $this->body(['appointment_date' => '2026-11-07']))->assertUnprocessable();
        $this->postJson('/api/appointments', $this->body(['appointment_date' => '2026-11-02', 'appointment_time' => '6:00 - 7:00 AM']))->assertUnprocessable();
        AppointmentCalendarDay::whereDate('date', $target)->update(['blocked_slots' => '[]', 'custom_slots' => json_encode([['label' => '9:30 - 10:30 AM', 'type' => 'AM']])]);
        $other = $this->appointment(['reference_no' => 'AP-OTHER', 'appointment_date' => $target]);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item, ['appointment_time' => '9:30 - 10:30 AM']))->assertUnprocessable();
        $other->update(['status' => 'Cancelled']);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item, ['appointment_time' => '9:30 - 10:30 AM']))->assertOk();
    }

    public function test_competing_reschedules_cannot_take_same_slot_or_overwrite_stale_record(): void
    {
        $first = $this->appointment();
        $second = $this->appointment(['reference_no' => 'AP-SECOND', 'appointment_time' => '1:00 - 2:00 PM']);
        $this->postJson('/api/customer/appointments/'.$first->id.'/reschedule', $this->move($first))->assertOk();
        $this->postJson('/api/customer/appointments/'.$second->id.'/reschedule', $this->move($second))->assertUnprocessable();
        $this->assertSame('2026-11-03', $second->fresh()->appointment_date->format('Y-m-d'));
    }

    public function test_admin_and_staff_can_save_https_links_with_stale_schedule_protection(): void
    {
        $item = $this->appointment();
        $url = '/api/admin/appointments/'.$item->id.'/meeting';
        $input = ['platform' => 'Google Meet', 'meeting_url' => 'https://meet.google.com/abc-defg-hij', 'expected_version' => 0];
        $this->patchJson($url, $input)->assertForbidden();
        $this->operator('staff');
        $this->patchJson($url, $input)->assertOk()->assertJsonPath('data.meeting_platform', 'Google Meet')->assertJsonPath('data.schedule_version', 1);
        $this->patchJson($url, $input)->assertConflict();
        $this->patchJson($url, [...$input, 'expected_version' => 1, 'meeting_url' => 'http://example.test/meeting'])->assertUnprocessable();
        $this->patchJson($url, [...$input, 'expected_version' => 1, 'meeting_url' => 'https://user:password@example.test/'])->assertUnprocessable();
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/customer/appointments/'.$item->id)->assertJsonPath('data.meeting_url', $input['meeting_url']);
        $this->operator();
        $this->patchJson($url, ['platform' => null, 'meeting_url' => null, 'expected_version' => 1])->assertOk()->assertJsonPath('data.meeting_status', 'Meeting link pending');
    }

    public function test_pm_slot_start_is_preserved_when_calendar_labels_change(): void
    {
        AppointmentTimeSlot::create(['label' => '1:00 - 2:00', 'type' => 'PM', 'sort_order' => 4, 'is_active' => true]);
        Carbon::setTestNow(Carbon::parse('2026-11-02 12:30:00', 'Asia/Manila')->utc());
        $response = $this->postJson('/api/appointments', $this->body(['appointment_date' => '2026-11-02', 'appointment_time' => '1:00 - 2:00']))->assertCreated();
        $item = Appointment::findOrFail($response->json('data.id'));
        $this->assertTrue($response->json('data.can_reschedule'));
        $this->assertSame('2026-11-02 05:00:00', $item->appointment_starts_at->utc()->format('Y-m-d H:i:s'));
        AppointmentTimeSlot::where('label', '1:00 - 2:00')->delete();
        $this->getJson('/api/customer/appointments/'.$item->id)->assertJsonPath('data.can_reschedule', true);
        Carbon::setTestNow(Carbon::parse('2026-11-02 13:00:00', 'Asia/Manila')->utc());
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertUnprocessable();
    }

    public function test_completed_and_face_to_face_appointments_do_not_accept_online_meeting_updates(): void
    {
        $item = $this->appointment(['appointment_method' => 'face_to_face']);
        $this->operator();
        $input = ['platform' => 'Zoom', 'meeting_url' => 'https://zoom.us/j/example', 'expected_version' => 0];
        $this->patchJson('/api/admin/appointments/'.$item->id.'/meeting', $input)->assertUnprocessable();
        $item->update(['appointment_method' => 'online', 'status' => 'Completed']);
        $this->patchJson('/api/admin/appointments/'.$item->id.'/meeting', $input)->assertUnprocessable();
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/customer/appointments/'.$item->id.'/reschedule', $this->move($item))->assertUnprocessable();
    }
}
