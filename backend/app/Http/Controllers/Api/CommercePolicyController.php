<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\CommercePolicy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CommercePolicyController extends Controller
{
    private function authorize(Request $request, bool $write = false): void
    {
        abort_unless(in_array(strtolower($request->user()?->role ?? ''), $write ? ['admin'] : ['admin', 'staff'], true), 403);
    }

    public function published(Request $request, ?string $version = null): JsonResponse
    {
        $policy = CommercePolicy::published($version);
        abort_if($version && ! $policy, 404);
        if ($policy) {
            unset($policy['published_by']);
        }

        return response()->json(['data' => $policy], 200, ['Cache-Control' => 'no-cache']);
    }

    public function show(Request $request): JsonResponse
    {
        $this->authorize($request);
        $settings = CommercePolicy::settings();
        $admin = strtolower($request->user()->role) === 'admin';

        return response()->json(['data' => ['revision' => $settings->revision, 'can_edit' => $admin,
            'published' => CommercePolicy::published($settings->published_version),
            ...($admin ? ['draft' => json_decode($settings->draft ?? 'null', true) ?? CommercePolicy::draft(),
                'has_saved_draft' => $settings->draft !== null] : [])]]);
    }

    public function saveDraft(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        $input = $request->validate(['expected_revision' => ['required', 'integer', 'min:0'],
            'title' => ['required', 'string', 'max:180'], 'terms_text' => ['required', 'string', 'min:40', 'max:20000'],
            'refund_text' => ['required', 'string', 'min:40', 'max:20000']]);
        DB::transaction(function () use ($input) {
            $settings = CommercePolicy::settings(true);
            abort_unless((int) $settings->revision === (int) $input['expected_revision'], 409, 'Policy settings changed. Refresh and review the latest draft.');
            DB::table('commerce_policy_settings')->where('id', 1)->update(['revision' => $settings->revision + 1,
                'draft' => json_encode(array_intersect_key($input, array_flip(['title', 'terms_text', 'refund_text'])))]);
        });

        return $this->show($request);
    }

    public function publish(Request $request): JsonResponse
    {
        $this->authorize($request, true);
        $input = $request->validate(['expected_revision' => ['required', 'integer', 'min:0'], 'approved' => ['required', 'accepted'],
            'initial_draft' => ['sometimes', 'array:title,terms_text,refund_text'],
            'initial_draft.title' => ['required_with:initial_draft', 'string', 'max:180'],
            'initial_draft.terms_text' => ['required_with:initial_draft', 'string', 'min:40', 'max:20000'],
            'initial_draft.refund_text' => ['required_with:initial_draft', 'string', 'min:40', 'max:20000']]);
        DB::transaction(function () use ($input, $request) {
            $settings = CommercePolicy::settings(true);
            abort_unless((int) $settings->revision === (int) $input['expected_revision'], 409, 'Policy settings changed. Refresh and review the latest draft.');
            $draft = $settings->draft ? json_decode($settings->draft, true) : ($input['initial_draft'] ?? null);
            abort_unless($draft, 422, 'Review the proposed policies and confirm FMRC approval before publishing.');
            if (! $settings->draft) {
                // An unchanged starting draft can be saved and published together
                // after approval. Verify the exact text reviewed by the Admin.
                foreach (CommercePolicy::draft() as $key => $text) {
                    abort_unless(($draft[$key] ?? null) === $text, 409, 'The proposed policies have changed. Refresh and review the latest draft before publishing.');
                }
            }
            $version = (string) Str::uuid();
            DB::table('commerce_policies')->insert(array_merge($draft, ['version' => $version, 'published_at' => now(), 'published_by' => $request->user()->id]));
            DB::table('commerce_policy_settings')->where('id', 1)->update(['draft' => json_encode($draft),
                'published_version' => $version, 'revision' => $settings->revision + 1]);
        });

        return $this->show($request);
    }
}
