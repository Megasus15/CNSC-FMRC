<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

final class CustomProductFiles
{
    public static function validate(Request $request): array
    {
        $request->validate(['attachments' => 'sometimes|array|max:5', 'attachments.*' => 'file|max:51200']);
        $files = $request->file('attachments', []);
        $total = 0;
        foreach ($files as $file) {
            $total += $file->getSize();
            $extension = strtolower($file->getClientOriginalExtension());
            $head = file_get_contents($file->getRealPath(), false, null, 0, 1024) ?: '';
            if (!in_array($extension, AppointmentFiles::EXTENSIONS, true)
                || preg_match('/<\?(?:php|=)|<script|<!doctype\s+html|<html/i', $head)
                || str_starts_with($head, 'MZ') || str_starts_with($head, "\x7fELF")) self::reject();
            if (in_array($extension, ['jpg', 'jpeg', 'png', 'gif', 'webp'], true) && !@getimagesize($file->getRealPath())) self::reject();
            if ($extension === 'pdf' && !str_starts_with($head, '%PDF-')) self::reject();
        }
        if (count($files) > 5 || $total > 50 * 1024 * 1024) self::reject();
        return $files;
    }

    public static function store(array $files, int $request, int $actor, ?int $message, array &$paths): void
    {
        foreach ($files as $file) {
            $path = $file->store('custom-product-designs', 'local');
            if (!$path) throw new \RuntimeException('The design file could not be saved. Please try again.');
            $paths[] = $path;
            DB::table('custom_product_attachments')->insert(['custom_product_request_id' => $request, 'author_id' => $actor, 'message_id' => $message,
                'name' => mb_substr(basename(str_replace('\\', '/', $file->getClientOriginalName())), 0, 200), 'path' => $path,
                'mime' => $file->getMimeType() ?: 'application/octet-stream', 'size' => $file->getSize(), 'created_at' => now(), 'updated_at' => now()]);
        }
    }

    private static function reject(): never
    {
        throw ValidationException::withMessages(['attachments' => 'Choose up to five supported images, documents or CAD files totaling 50 MB or less.']);
    }
}
