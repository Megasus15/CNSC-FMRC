<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Service;
use App\Models\User;
use App\Services\AppointmentIntake;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UcnAppointmentIntakeTest extends TestCase
{
    use RefreshDatabase;

    private User $customer;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-11-06 08:00:00', 'Asia/Manila')->utc());
        Mail::fake(); Storage::fake('local');
        config(['services.turnstile.enabled' => false, 'appointment_products.enabled' => true]);
        $this->customer = User::factory()->create(['role' => 'customer']);
        Sanctum::actingAs($this->customer);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow(); parent::tearDown();
    }

    private function body(array $extra = []): array
    {
        return $extra + ['first_name'=>'Maria','last_name'=>'Santos','contact_number'=>'09171234567','email'=>'maria@gmail.com',
            'country'=>'Philippines','full_address'=>'Daet','client_type'=>AppointmentIntake::CLIENT,'university_department'=>'CCMS',
            'purpose'=>'Inquiries','appointment_date'=>'2026-11-09','appointment_time'=>'9:00 - 10:00 AM'];
    }

    private function pdf(string $name = 'request.pdf'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
    }

    public function test_all_eight_departments_allow_booking_without_pr_and_other_clients_still_work(): void
    {
        foreach (array_keys(AppointmentIntake::DEPARTMENTS) as $code) {
            $data = $this->postJson('/api/appointments', $this->body(['university_department'=>$code]))->assertCreated()->json('data');
            $this->assertSame($code, $data['university_department']);
            $this->assertSame(AppointmentIntake::label($code), $data['university_department_label']);
            $this->assertEmpty($data['attachments']);
            Appointment::findOrFail($data['id'])->delete();
        }
        $this->postJson('/api/appointments', $this->body(['client_type'=>'Student','university_department'=>null]))->assertCreated();
    }

    public function test_department_and_pr_are_validated_conditionally(): void
    {
        foreach ([null,'IFMS','WRONG'] as $code) $this->postJson('/api/appointments', $this->body(['university_department'=>$code]))->assertUnprocessable()->assertJsonValidationErrors('university_department');
        $this->postJson('/api/appointments', $this->body(['client_type'=>'Student']))->assertUnprocessable();
        $this->post('/api/appointments', $this->body(['client_type'=>'Student','university_department'=>null,'purchase_request'=>$this->pdf()]), ['Accept'=>'application/json'])->assertUnprocessable();
        foreach ([$this->pdf()->size(10241), UploadedFile::fake()->createWithContent('fake.pdf','This is not a PDF'), UploadedFile::fake()->createWithContent('broken.pdf',"%PDF-1.4\nunreadable"), UploadedFile::fake()->create('request.docx',1)] as $file) {
            $this->post('/api/appointments', $this->body(['purchase_request'=>$file]), ['Accept'=>'application/json'])->assertUnprocessable()->assertJsonValidationErrors('purchase_request');
        }
        $this->assertDatabaseCount('appointments', 0);
        $this->assertEmpty(Storage::disk('local')->allFiles());
    }

    public function test_private_pr_downloads_work_for_owner_and_both_operator_roles_without_public_metadata(): void
    {
        $data=$this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf(),'attachments'=>[UploadedFile::fake()->create('part.stl',1)]]),['Accept'=>'application/json'])->assertCreated()->json('data');
        $pr=collect($data['attachments'])->firstWhere('kind','purchase_request');
        $route='/api/customer/appointments/'.$data['id'].'/attachments/'.$pr['id'];
        $this->get($route)->assertOk()->assertHeader('X-Content-Type-Options','nosniff');
        foreach (['admin','staff'] as $role) {
            Sanctum::actingAs(User::factory()->create(['role'=>$role]));
            $this->get($route)->assertOk();
            $this->getJson('/api/admin/appointments/'.$data['id'])->assertOk()->assertJsonPath('data.university_department','CCMS');
        }
        Sanctum::actingAs(User::factory()->create(['role'=>'customer']));
        $this->get($route)->assertNotFound();
        $this->getJson('/api/appointments/'.$data['reference_no'].'/verify')->assertOk()->assertJsonMissingPath('data.attachments')->assertDontSee($pr['name']);
        Mail::assertSent(\App\Mail\AppointmentConfirmation::class, fn ($mail) => str_contains($mail->render(), 'College of Computing and Multimedia Studies'));
    }

    public function test_real_images_and_pr_size_boundary_are_accepted_and_combined_limit_is_atomic(): void
    {
        foreach (['jpg','png','webp'] as $extension) {
            $data=$this->post('/api/appointments',$this->body(['purchase_request'=>UploadedFile::fake()->image('scan.'.$extension)]),['Accept'=>'application/json'])->assertCreated()->json('data');
            Appointment::findOrFail($data['id'])->delete();
        }
        $this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf()->size(10240)]),['Accept'=>'application/json'])->assertCreated();
        $before=Storage::disk('local')->allFiles();
        $this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf()->size(10240),'attachments'=>[UploadedFile::fake()->create('a.stl',42000)]]),['Accept'=>'application/json'])->assertUnprocessable();
        $this->assertSame($before,Storage::disk('local')->allFiles());
    }

    public function test_draft_pr_replacement_failure_removal_and_booking_preserve_categories(): void
    {
        $service=Service::create(['title'=>'3D Printing','category'=>'Prototyping','accepts_appointment_products'=>true]);
        $brief=['service_id'=>$service->id,'name'=>'Desk sign','description'=>'A department desk sign','quantity'=>1,'dimensions'=>'20 x 8 cm','material'=>'PLA','colors'=>'Maroon'];
        $draftBody=['request_key'=>(string)Str::uuid(),'requirements'=>json_encode($brief),'booking'=>json_encode(['aptRole'=>AppointmentIntake::CLIENT,'aptUniversityDepartment'=>'CCMS'])];
        $draft=$this->post('/api/customer/appointment-products/drafts',$draftBody+['purchase_request'=>$this->pdf(),'attachments'=>[UploadedFile::fake()->create('part.stl',1)]],['Accept'=>'application/json'])->assertOk()->json('data');
        $old=DB::table('appointment_product_files')->where('kind','purchase_request')->first();
        $this->post('/api/customer/appointment-products/drafts',$draftBody+['draft_id'=>$draft['id'],'expected_revision'=>9,'purchase_request'=>$this->pdf('new.pdf')],['Accept'=>'application/json'])->assertConflict();
        Storage::disk('local')->assertExists($old->path);
        $draft=$this->post('/api/customer/appointment-products/drafts',$draftBody+['draft_id'=>$draft['id'],'expected_revision'=>0,'purchase_request'=>$this->pdf('new.pdf')],['Accept'=>'application/json'])->assertOk()->json('data');
        $this->assertCount(2,$draft['files']);
        $this->assertSame('new.pdf',collect($draft['files'])->firstWhere('kind','purchase_request')['name']);
        $booking=$this->body(['product_requested'=>true,'product_data'=>$brief,'product_draft_id'=>$draft['id'],'product_revision'=>$draft['revision'],'request_key'=>$draftBody['request_key']]);
        $appointment=$this->postJson('/api/appointments',$booking)->assertCreated()->json('data');
        $this->assertCount(2,$appointment['attachments']);
        $this->assertCount(1,collect($appointment['attachments'])->where('kind','purchase_request'));
        $replay=$this->postJson('/api/appointments',$booking)->assertCreated()->json('data');
        $this->assertSame($appointment['id'],$replay['id']);
        $this->assertDatabaseCount('appointment_attachments',2);
        $this->assertDatabaseCount('appointment_product_files',2);
        $job=\App\Models\AppointmentProductJob::findOrFail($draft['id']);
        $job->forceFill(['state'=>'ready_for_quote','discussed_at'=>now()])->save();
        Sanctum::actingAs(User::factory()->create(['role'=>'staff']));
        $pr=collect($appointment['custom_product']['files'])->firstWhere('kind','purchase_request');
        $this->postJson('/api/admin/appointment-products/'.$job->id.'/quotations',[
            'request_key'=>(string)Str::uuid(),'expected_revision'=>$job->revision,'specifications'=>$brief,'unit_price'=>200,'shipping_fee'=>0,
            'fulfillment_type'=>'pickup','lead_time'=>'Five days','design_notes'=>'The approved sign design','proof_file_ids'=>[$pr['id']],
        ])->assertUnprocessable()->assertJsonPath('message','Choose design proofs from this appointment only.');
    }

    public function test_six_files_are_allowed_and_failed_booking_leaves_no_orphan_files(): void
    {
        $designs=array_map(fn ($n)=>UploadedFile::fake()->create('part'.$n.'.stl',1),range(1,5));
        $this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf(),'attachments'=>$designs]),['Accept'=>'application/json'])->assertCreated()->assertJsonCount(6,'data.attachments');
        $before=Storage::disk('local')->allFiles();
        $this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf('conflict.pdf')]),['Accept'=>'application/json'])->assertUnprocessable();
        $this->assertSame($before,Storage::disk('local')->allFiles());
        $this->assertDatabaseCount('appointments',1);
        $this->app['auth']->forgetGuards();
        $this->post('/api/appointments',$this->body(['purchase_request'=>$this->pdf('guest.pdf')]),['Accept'=>'application/json'])->assertUnauthorized();
    }

    public function test_draft_pr_removal_and_client_switch_do_not_transfer_hidden_requests(): void
    {
        $service=Service::create(['title'=>'3D Printing','category'=>'Prototyping','accepts_appointment_products'=>true]);
        $brief=['service_id'=>$service->id,'name'=>'Desk sign','description'=>'Department sign','quantity'=>1];
        $input=['request_key'=>(string)Str::uuid(),'requirements'=>json_encode($brief),'booking'=>json_encode(['aptRole'=>AppointmentIntake::CLIENT,'aptUniversityDepartment'=>'CCMS'])];
        $draft=$this->post('/api/customer/appointment-products/drafts',$input+['purchase_request'=>$this->pdf()],['Accept'=>'application/json'])->assertOk()->json('data');
        $draft=$this->postJson('/api/customer/appointment-products/drafts',$input+['draft_id'=>$draft['id'],'expected_revision'=>0,'purchase_request_removed'=>true])->assertOk()->assertJsonCount(0,'data.files')->json('data');
        $draft=$this->post('/api/customer/appointment-products/drafts',$input+['draft_id'=>$draft['id'],'expected_revision'=>$draft['revision'],'purchase_request'=>$this->pdf()],['Accept'=>'application/json'])->assertOk()->json('data');
        $this->postJson('/api/appointments',$this->body(['client_type'=>'Student','university_department'=>null,'product_requested'=>true,'product_data'=>$brief,
            'product_draft_id'=>$draft['id'],'product_revision'=>$draft['revision'],'request_key'=>$input['request_key']]))->assertCreated()->assertJsonCount(0,'data.attachments')->assertJsonCount(0,'data.custom_product.files');
    }
}
