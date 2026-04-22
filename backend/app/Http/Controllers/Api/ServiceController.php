<?php

namespace App\Http\Controllers\Api;

use App\Models\Service;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class ServiceController extends Controller
{
    // ─── Public ─────────────────────────────────────────────────────────────────

    public function index(): JsonResponse
    {
        $services = Service::orderBy('sort_order')->orderBy('id')->get()
            ->map(fn($s) => $this->format($s));

        return response()->json(['data' => $services]);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────────

    public function adminIndex(): JsonResponse
    {
        return $this->index();
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title'             => 'required|string|max:255',
            'category'          => 'required|string|max:100',
            'description'       => 'nullable|string',
            'image_data'        => 'nullable|string',
            'modal_description' => 'nullable|string',
            'modal_features'    => 'nullable|array',
            'modal_features.*'  => 'string|max:200',
            'modal_materials'   => 'nullable|array',
            'modal_materials.*' => 'string|max:200',
            'modal_best_for'    => 'nullable|array',
            'modal_best_for.*'  => 'string|max:200',
            'sort_order'        => 'integer|min:0',
        ]);

        $service = Service::create($validated);

        return response()->json([
            'message' => 'Service created successfully.',
            'data'    => $this->format($service),
        ], 201);
    }

    public function update(Request $request, Service $service): JsonResponse
    {
        $validated = $request->validate([
            'title'             => 'required|string|max:255',
            'category'          => 'required|string|max:100',
            'description'       => 'nullable|string',
            'image_data'        => 'nullable|string',
            'modal_description' => 'nullable|string',
            'modal_features'    => 'nullable|array',
            'modal_features.*'  => 'string|max:200',
            'modal_materials'   => 'nullable|array',
            'modal_materials.*' => 'string|max:200',
            'modal_best_for'    => 'nullable|array',
            'modal_best_for.*'  => 'string|max:200',
            'sort_order'        => 'integer|min:0',
        ]);

        $service->update($validated);

        return response()->json([
            'message' => 'Service updated successfully.',
            'data'    => $this->format($service->fresh()),
        ]);
    }

    public function destroy(Service $service): JsonResponse
    {
        $service->delete();

        return response()->json(['message' => 'Service deleted successfully.']);
    }

    // ─── Helper ──────────────────────────────────────────────────────────────────

    private function format(Service $s): array
    {
        return [
            'id'                => $s->id,
            'title'             => $s->title,
            'category'          => $s->category,
            'description'       => $s->description,
            'image_data'        => $s->image_data,
            'modal_description' => $s->modal_description,
            'modal_features'    => $s->modal_features ?? [],
            'modal_materials'   => $s->modal_materials ?? [],
            'modal_best_for'    => $s->modal_best_for ?? [],
            'sort_order'        => $s->sort_order,
            'created_at'        => $s->created_at,
            'updated_at'        => $s->updated_at,
        ];
    }
}
