<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PsgcController
 *
 * Proxies calls to the PSGC Cloud public API (https://psgc.cloud/api)
 * and caches responses to minimise external round-trips.
 *
 * Hierarchy:
 *   Regions  →  Provinces (by region code)
 *              →  Cities/Municipalities (by province code)
 *                →  Barangays (by city-municipality code)
 */
class PsgcController extends Controller
{
    private const BASE_URL  = 'https://psgc.cloud/api';
    private const CACHE_TTL = 86400; // 24 hours in seconds

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Fetch from PSGC API, with a cache layer.
     *
     * @param  string $endpoint  e.g. "regions" or "regions/0500000000/provinces"
     * @return array|null        Decoded JSON array, or null on failure
     */
    private function psgcFetch(string $endpoint): ?array
    {
        $cacheKey = 'psgc_' . md5($endpoint);

        return Cache::remember($cacheKey, self::CACHE_TTL, function () use ($endpoint) {
            try {
                $response = Http::timeout(15)
                    ->withHeaders(['Accept' => 'application/json'])
                    ->get(self::BASE_URL . '/' . $endpoint);

                if ($response->successful()) {
                    return $response->json();
                }

                Log::warning("[PSGC] Non-2xx response for /{$endpoint}: " . $response->status());
                return null;
            } catch (\Throwable $e) {
                Log::error("[PSGC] Request failed for /{$endpoint}: " . $e->getMessage());
                return null;
            }
        });
    }

    /**
     * Build a standardised JSON error response.
     */
    private function errorResponse(string $message, int $status = 502): JsonResponse
    {
        return response()->json(['error' => $message], $status);
    }

    // -------------------------------------------------------------------------
    // Endpoints
    // -------------------------------------------------------------------------

    /**
     * GET /api/psgc/regions
     * Returns all Philippine regions.
     */
    public function regions(): JsonResponse
    {
        $data = $this->psgcFetch('regions');

        if ($data === null) {
            return $this->errorResponse('Could not fetch regions from PSGC API.');
        }

        // Normalise: return only code + name
        $regions = collect($data)->map(fn ($r) => [
            'code' => $r['code'] ?? '',
            'name' => $r['name'] ?? '',
        ])->values()->toArray();

        return response()->json($regions);
    }

    /**
     * GET /api/psgc/regions/{regionCode}/provinces
     * Returns provinces that belong to the given region.
     */
    public function provinces(string $regionCode): JsonResponse
    {
        $regionCode = preg_replace('/[^0-9]/', '', $regionCode);

        if (strlen($regionCode) !== 10) {
            return $this->errorResponse('Invalid region code.', 422);
        }

        $data = $this->psgcFetch("regions/{$regionCode}/provinces");

        if ($data === null) {
            return $this->errorResponse('Could not fetch provinces from PSGC API.');
        }

        $provinces = collect($data)->map(fn ($p) => [
            'code' => $p['code'] ?? '',
            'name' => $p['name'] ?? '',
        ])->values()->toArray();

        return response()->json($provinces);
    }

    /**
     * GET /api/psgc/provinces/{provinceCode}/cities-municipalities
     * Returns cities and municipalities that belong to the given province.
     */
    public function citiesMunicipalities(string $provinceCode): JsonResponse
    {
        $provinceCode = preg_replace('/[^0-9]/', '', $provinceCode);

        if (strlen($provinceCode) !== 10) {
            return $this->errorResponse('Invalid province code.', 422);
        }

        $data = $this->psgcFetch("provinces/{$provinceCode}/cities-municipalities");

        if ($data === null) {
            return $this->errorResponse('Could not fetch cities/municipalities from PSGC API.');
        }

        $cities = collect($data)->map(fn ($c) => [
            'code' => $c['code'] ?? '',
            'name' => $c['name'] ?? '',
        ])->values()->toArray();

        return response()->json($cities);
    }

    /**
     * GET /api/psgc/cities-municipalities/{cityMunCode}/barangays
     * Returns barangays that belong to the given city or municipality.
     */
    public function barangays(string $cityMunCode): JsonResponse
    {
        $cityMunCode = preg_replace('/[^0-9]/', '', $cityMunCode);

        if (strlen($cityMunCode) !== 10) {
            return $this->errorResponse('Invalid city/municipality code.', 422);
        }

        $data = $this->psgcFetch("cities-municipalities/{$cityMunCode}/barangays");

        if ($data === null) {
            return $this->errorResponse('Could not fetch barangays from PSGC API.');
        }

        $barangays = collect($data)->map(fn ($b) => [
            'code' => $b['code'] ?? '',
            'name' => $b['name'] ?? '',
        ])->values()->toArray();

        return response()->json($barangays);
    }
}
