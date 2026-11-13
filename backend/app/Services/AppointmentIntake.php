<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

final class AppointmentIntake
{
    public const CLIENT = 'UCN College / Department';
    public const DEPARTMENTS = [
        'CCMS' => 'College of Computing and Multimedia Studies',
        'COENG' => 'College of Engineering',
        'CAS' => 'College of Arts and Sciences',
        'CBPA' => 'College of Business and Public Administration',
        'COED' => 'College of Education',
        'CANR' => 'College of Agriculture and Natural Resources',
        'CFAST' => 'College of Fisheries, Aquatic Sciences, and Technology (formerly IFMS)',
        'COTT' => 'College of Trades and Technology',
    ];

    public static function department(?string $client, mixed $department, bool $draft = false): ?string
    {
        $ucn = $client === self::CLIENT;
        $data = Validator::make(['university_department' => $department], ['university_department' => [
            $ucn && !$draft ? 'required' : 'nullable', Rule::prohibitedIf(!$ucn), Rule::in(array_keys(self::DEPARTMENTS)),
        ]], ['university_department.required' => 'Choose your UCN college or department.',
            'university_department.in' => 'Choose a valid UCN college or department.'])->validate();

        return $data['university_department'] ?? null;
    }

    public static function label(?string $code): ?string
    {
        return isset(self::DEPARTMENTS[$code ?? '']) ? $code.' — '.self::DEPARTMENTS[$code] : null;
    }

    public static function purchaseRequest(Request $request, bool $ucn): array
    {
        $request->validate(['purchase_request' => [Rule::prohibitedIf(!$ucn), 'nullable', 'file', 'max:10240', 'mimes:pdf,jpg,jpeg,png,webp'],
            'purchase_request_removed' => 'sometimes|boolean']);
        $file = $request->file('purchase_request');
        if (!$file) return [];
        $head = file_get_contents($file->getRealPath(), false, null, 0, 8);
        $readable = $file->getMimeType() === 'application/pdf'
            ? str_starts_with($head ?: '', '%PDF-') && str_contains(file_get_contents($file->getRealPath()), '%%EOF')
            : @getimagesize($file->getRealPath()) !== false;
        Validator::make(['purchase_request' => $readable], ['purchase_request' => 'accepted'],
            ['purchase_request.accepted' => 'The PR could not be read. Choose a valid PDF, JPG, PNG, or WebP file.'])->validate();
        abort_unless($request->user('sanctum')?->role === 'customer', 401, 'Sign in to attach a private Purchase Request.');

        return [$file];
    }

    public static function limits(array $files): void
    {
        $pr = count(array_filter($files, fn ($file) => ($file['kind'] ?? 'design') === 'purchase_request'));
        $valid = $pr <= 1 && count($files) - $pr <= 5 && array_sum(array_column($files, 'size')) <= 50 * 1024 * 1024;
        Validator::make(['attachments' => $valid], ['attachments' => 'accepted'],
            ['attachments.accepted' => 'Keep up to five design files and one PR, totaling 50 MB or less.'])->validate();
    }
}
