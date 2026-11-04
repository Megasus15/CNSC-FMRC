<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\{CustomProductRequest, Order, Service};
use App\Services\{CustomProductFiles, CustomProducts, GatewayPayments};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB, Storage};

class CustomProductController extends Controller
{
    private function operator(Request $request): bool
    {
        $role = $request->user()?->role;
        abort_unless(in_array($role, ['customer','admin','staff'], true), 403);
        $operator = in_array($role, ['admin','staff'], true);
        abort_unless($operator === str_contains($request->path(), '/admin/'), 403);
        return $operator;
    }

    private function access(Request $request, CustomProductRequest $customRequest): bool
    {
        $operator = $this->operator($request);
        abort_unless($operator ? $customRequest->status !== 'draft' : $customRequest->customer_id === $request->user()->id, 404);
        return $operator;
    }

    public function index(Request $request)
    {
        $operator = $this->operator($request);
        $input = $request->validate(['search'=>'nullable|string|max:180','status'=>'nullable|string|max:40','service_id'=>'nullable|integer','page'=>'nullable|integer|min:1']);
        $q = CustomProductRequest::query()->with('customer')->when($operator, fn($q)=>$q->where('status','!=','draft'), fn($q)=>$q->where('customer_id',$request->user()->id));
        if ($operator && \App\Support\CustomProductSchema::archivingReady()) $q->where('is_archived', false);
        $counts = (clone $q)->selectRaw('status, COUNT(*) as aggregate')->groupBy('status')->pluck('aggregate','status');
        if (!empty($input['status']) && $input['status'] !== 'all') $q->where('status',$input['status']);
        if (!empty($input['service_id'])) $q->where(fn($q)=>$q->where('service_id',$input['service_id'])->orWhere('service_snapshot->id',(int)$input['service_id']));
        if (!empty($input['search'])) {
            $search = $input['search'];
            $q->where(fn($q)=>$q->where('specifications','like','%'.$search.'%')->orWhereHas('customer',fn($q)=>$q->where('name','like','%'.$search.'%'))
                ->orWhere('id',(int)preg_replace('/^CUS-0*/i','',$search)));
        }
        $page = $q->orderByDesc('updated_at')->paginate(10);
        $page->setCollection($page->getCollection()->map(function($r) use ($operator) {
            $order = CustomProducts::activeOrder($r);
            $archiveError = $operator ? CustomProducts::archiveError($r) : null;
            return ['id'=>$r->id,'reference'=>$r->reference(),'title'=>$r->specifications['title'] ?? 'Untitled draft','service'=>$r->service_snapshot,
                'customer_name'=>$r->customer?->name,'status'=>$r->status,'status_label'=>$order ? CustomProducts::statusLabel($order) : (CustomProducts::LABELS[$r->status] ?? $r->status),
                'quantity'=>$r->specifications['quantity'] ?? 0,'updated_at'=>$r->updated_at?->toIso8601String(),
                'revision'=>$r->revision, 'can_archive'=>$operator && !$archiveError, 'archive_reason'=>$archiveError];
        }));
        return response()->json(['data'=>$page->items(),'current_page'=>$page->currentPage(),'last_page'=>$page->lastPage(),'total'=>$page->total(),'counts'=>$counts])->header('Cache-Control','no-store');
    }

    public function store(Request $request)
    {
        abort_if($this->operator($request),403);
        $data = $request->validate(['creation_key'=>'required|uuid','service_id'=>'required|integer']);
        $service = Service::whereKey($data['service_id'])->where('accepts_custom_requests',true)->first();
        abort_unless($service,422,'Choose a service that accepts custom product requests.');
        $r = CustomProductRequest::firstOrCreate(['customer_id'=>$request->user()->id,'creation_key'=>$data['creation_key']],
            ['service_id'=>$service->id,'service_snapshot'=>['id'=>$service->id,'title'=>$service->title,'category'=>$service->category],'specifications'=>[]]);
        abort_unless($r->service_id === $service->id, 409, 'This draft key was used for another service. Open the saved draft or start a new request.');
        return response()->json(['data'=>CustomProducts::present($r->refresh(),false)],201)->header('Cache-Control','no-store');
    }

    public function show(Request $request, CustomProductRequest $customRequest)
    {
        $operator = $this->access($request,$customRequest);
        return response()->json(['data'=>CustomProducts::present($customRequest,$operator)])->header('Cache-Control','no-store');
    }

    public function action(Request $request, CustomProductRequest $customRequest, string $action)
    {
        $operator = $this->access($request,$customRequest);
        if ($request->has('payload')) {
            $payload = json_decode($request->input('payload'),true);
            abort_unless(is_array($payload),422,'The form could not be read. Please try again.');
            $request->merge($payload);
        }
        $files = CustomProductFiles::validate($request);
        $r = CustomProducts::mutate($customRequest,$request->user()->id,$request->user()->role,$action,$request->except(['attachments','payload']),$files);
        $response = ['message'=>'Your changes have been saved.','data'=>CustomProducts::present($r->fresh(),$operator)];
        if ($action === 'accept') {
            $order = Order::where('custom_product_quote_id',$request->input('quote_id'))->where('customer_id',$request->user()->id)->firstOrFail();
            $response['payment'] = app(GatewayPayments::class)->checkout($order, $request->input('app_context') === 'customer' ? 'customer' : '');
        }
        return response()->json($response)->header('Cache-Control','no-store');
    }

    public function attachment(Request $request, CustomProductRequest $customRequest, int $attachment)
    {
        $this->access($request,$customRequest);
        $file = DB::table('custom_product_attachments')->where('custom_product_request_id',$customRequest->id)->where('id',$attachment)->first();
        abort_unless($file && Storage::disk('local')->exists($file->path),404);
        $inline = $request->boolean('preview') && in_array($file->mime,['image/jpeg','image/png','image/webp','image/gif'],true);
        return response()->file(Storage::disk('local')->path($file->path),['Content-Type'=>$file->mime,'Cache-Control'=>'private, no-store',
            'X-Content-Type-Options'=>'nosniff','Content-Security-Policy'=>"default-src 'none'; sandbox",
            'Content-Disposition'=>($inline ? 'inline' : 'attachment').'; filename="'.addcslashes(preg_replace('/[\r\n]/','',$file->name),'"\\').'"']);
    }

    public function production(Request $request, Order $order)
    {
        abort_unless($this->operator($request),403);
        $data = $request->validate(['action'=>'required|in:start,ready', 'expected_revision'=>'sometimes|integer|min:0', 'request_key'=>'required_with:expected_revision|uuid']);
        $o = CustomProducts::production($order,$data['action'],$request->user()->id,$data['expected_revision'] ?? null,$data['request_key'] ?? null);
        return response()->json(['message'=>'Production status updated.','data'=>CustomProducts::orderFields($o)]);
    }
}
