<?php

namespace App\Http\Controllers\Api;

use App\Models\HomeSdg;
use App\Models\Service;
use App\Models\SiteSetting;
use App\Support\CustomProductSchema;
use App\Support\WebsiteContentLimits;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/** Publish one editor draft without exposing partially saved collections. */
class WebsitePageController extends Controller
{
    public function update(Request $request, string $page): JsonResponse
    {
        abort_unless(in_array(strtolower((string) $request->user()?->role), ['admin', 'staff'], true), 403);
        abort_unless(in_array($page, ['home', 'services'], true), 404);

        $input = $request->validate([
            'settings' => ['present', 'array'],
            'services' => ['sometimes', 'array:upsert,delete'],
            'services.upsert' => ['sometimes', 'array'],
            'services.upsert.*' => ['array'],
            'services.upsert.*.id' => ['sometimes', 'integer', 'min:1', 'distinct'],
            'services.delete' => ['sometimes', 'array'],
            'services.delete.*' => ['integer', 'min:1', 'distinct'],
            'sdgs' => ['sometimes', 'array:upsert,delete'],
            'sdgs.upsert' => ['sometimes', 'array', 'max:8'],
            'sdgs.upsert.*' => ['array'],
            'sdgs.upsert.*.id' => ['sometimes', 'integer', 'min:1', 'distinct'],
            'sdgs.delete' => ['sometimes', 'array', 'max:8'],
            'sdgs.delete.*' => ['integer', 'min:1', 'distinct'],
        ]);
        $settings = $input['settings'];
        $logos = ['nav_logo_image', 'footer_logo_primary_image', 'footer_logo_secondary_image', 'favicon_image'];
        foreach ($settings as $key => $value) {
            $allowed = $page === 'home'
                ? str_starts_with($key, 'hero_') || str_starts_with($key, 'editorial_home_') || $key === 'home_sdg_heading' || in_array($key, $logos, true)
                : str_starts_with($key, 'editorial_services_');
            if (! $allowed || (! is_null($value) && ! is_scalar($value))) {
                throw ValidationException::withMessages(['settings.'.$key => 'This setting does not belong to this page.']);
            }
        }
        Validator::make($settings, WebsiteContentLimits::settingsRules(), WebsiteContentLimits::messages())->validate();
        if ($page !== 'home' && isset($input['sdgs'])) {
            throw ValidationException::withMessages(['sdgs' => 'SDG badges are managed on the Home page.']);
        }
        $changes = [];
        foreach (['services', 'sdgs'] as $collection) {
            $changes[$collection] = ['upsert' => [], 'delete' => $input[$collection]['delete'] ?? []];
            foreach ($input[$collection]['upsert'] ?? [] as $row) {
                $existing = isset($row['id']);
                $rules = $collection === 'services' ? WebsiteContentLimits::serviceRules(partial: $existing) : [
                    'title' => [$existing ? 'sometimes' : 'required', 'required', 'string', 'max:160'],
                    'description' => ['sometimes', 'nullable', 'string', 'max:2000'],
                    'image_data' => ['sometimes', 'nullable', 'string'],
                    'sort_order' => ['sometimes', 'integer', 'min:0'],
                    'is_visible' => ['sometimes', 'boolean'],
                ];
                $validated = Validator::make($row, $rules, WebsiteContentLimits::messages())->validate();
                if ($collection === 'services' && array_key_exists('accepts_custom_requests', $validated) && !CustomProductSchema::ready()) {
                    abort_if($validated['accepts_custom_requests'], 503, CustomProductSchema::MESSAGE);
                    unset($validated['accepts_custom_requests']);
                }
                $changes[$collection]['upsert'][] = ['id' => $row['id'] ?? null, 'values' => $validated];
            }
        }

        DB::transaction(function () use ($settings, $changes): void {
            foreach (['services' => Service::class, 'sdgs' => HomeSdg::class] as $name => $model) {
                $change = $changes[$name];
                if (! $change['upsert'] && ! $change['delete']) {
                    continue;
                }
                $ids = array_values(array_filter(array_column($change['upsert'], 'id')));
                if (array_intersect($ids, $change['delete'])) {
                    throw ValidationException::withMessages([$name => 'A record cannot be updated and removed together.']);
                }
                $known = $model::query()->lockForUpdate()->get()->keyBy('id');
                foreach (array_merge($ids, $change['delete']) as $id) {
                    if (! $known->has($id)) {
                        throw ValidationException::withMessages([$name => 'This content changed elsewhere. Refresh before saving.']);
                    }
                }
                if ($name === 'sdgs' && $known->count() - count($change['delete']) + count(array_filter($change['upsert'], fn ($row) => $row['id'] === null)) > HomeSdg::MAX_SLOTS) {
                    throw ValidationException::withMessages(['sdgs' => 'The Home page supports up to eight SDG badges.']);
                }
                foreach ($change['delete'] as $id) {
                    $known[$id]->delete();
                }
                foreach ($change['upsert'] as $row) {
                    $values = $row['values'];
                    // Public service reads return an image URL; never store that
                    // thumbnail reference over the original artwork.
                    if ($name === 'services' && $row['id'] && isset($values['image_data']) && preg_match('~^(?:https?://|/api/)~', $values['image_data'])) {
                        unset($values['image_data']);
                    }
                    if ($row['id']) {
                        $known[$row['id']]->update($values);
                    } else {
                        $model::create($values);
                    }
                }
            }
            foreach ($settings as $key => $value) {
                SiteSetting::set($key, $value);
            }
        });

        return response()->json(['message' => 'All page changes saved.']);
    }
}
