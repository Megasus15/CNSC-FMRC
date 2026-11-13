<?php

namespace App\Services;

use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

final class AppointmentFiles
{
    public const EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'stl', 'obj', 'step', 'stp', 'iges', 'igs', 'dxf', 'dwg'];

    public static function validate(Request $request, bool $allowOperator = false): array
    {
        $files = $request->file('attachments', []);
        if ($request->hasFile('attachment')) {
            $files[] = $request->file('attachment');
        }
        if (count($files) > 5) {
            self::reject('Choose up to five files, totaling 50 MB or less.');
        }
        $total = 0;
        foreach ($files as $file) {
            if (! $file instanceof UploadedFile || ! $file->isValid()) {
                self::reject('A file could not be received. Please select it again.');
            }
            $total += $file->getSize();
            if (! in_array(strtolower($file->getClientOriginalExtension()), self::EXTENSIONS, true)) {
                self::reject('Use an image, PDF, Word document, or a supported CAD design file.');
            }
            $head = file_get_contents($file->getRealPath(), false, null, 0, 256) ?: '';
            if (preg_match('/^\s*(<\?php|<script|<!doctype\s+html|<html)/i', $head) || str_starts_with($head, 'MZ') || str_starts_with($head, "\x7fELF")) {
                self::reject('This file cannot be accepted. Please upload a design document.');
            }
        }
        if ($total > 50 * 1024 * 1024) {
            self::reject('The combined file size must be 50 MB or less.');
        }
        if ($files && (! $request->user('sanctum') || !in_array($request->user('sanctum')->role, $allowOperator ? ['customer','admin','staff'] : ['customer'], true))) {
            abort(401, 'Sign in to attach private design files.');
        }

        return $files;
    }

    public static function store(array $files, string $kind = 'design'): array
    {
        $stored = [];
        try {
            foreach ($files as $file) {
                $path = $file->store('appointment-attachments', 'local');
                if (! $path) {
                    throw new \RuntimeException('Design file storage is unavailable.');
                }
                $stored[] = ['name' => mb_substr(basename(str_replace('\\', '/', $file->getClientOriginalName())), 0, 200),
                    'path' => $path, 'mime' => $file->getMimeType() ?: 'application/octet-stream', 'size' => $file->getSize(), 'created_at' => now(), 'kind' => $kind];
            }
        } catch (\Throwable $error) {
            self::clean($stored);
            throw $error;
        }

        return $stored;
    }

    public static function clean(array $files): void
    {
        foreach ($files as $file) {
            Storage::disk('local')->delete($file['path']);
        }
    }

    public static function records(int $appointment): array
    {
        return DB::table('appointment_attachments')->where('appointment_id', $appointment)->orderBy('id')->get()->map(fn ($file) => [
            'id' => $file->id, 'name' => $file->name, 'size' => $file->size, 'kind' => $file->kind ?? 'design', 'download_url' => url('/api/customer/appointments/'.$appointment.'/attachments/'.$file->id),
        ])->all();
    }

    private static function reject(string $message): never
    {
        throw ValidationException::withMessages(['attachments' => $message]);
    }
}
