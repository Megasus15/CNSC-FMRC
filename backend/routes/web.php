<?php

use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\PasswordResetController;
use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('home');
});

Route::get('/appointments/verify/{reference}', [AppointmentController::class, 'verifyPage']);

// Public: Customer password reset page (opened from the reset email link).
// Served by Laravel (port 8000) so the link always works even if the
// Live Server frontend is not running.
Route::get('/reset-password', [PasswordResetController::class, 'showResetForm']);


Route::get('/dashboard', function () {
    return view('dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');
});

require __DIR__ . '/auth.php';
