<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AppointmentController;

Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);
Route::get('/appointments', [AppointmentController::class, 'index']);
Route::post('/appointments', [AppointmentController::class, 'store']);
Route::delete('/appointments/{appointment}', [AppointmentController::class, 'destroy']);
Route::patch('/appointments/{appointment}/archive', [AppointmentController::class, 'archive']);
Route::get('/appointments/calendar', [AppointmentController::class, 'calendar']);
Route::put('/appointments/calendar', [AppointmentController::class, 'updateCalendar']);
Route::get('/appointments/{reference}/verify', [AppointmentController::class, 'verifyByReference']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/users', [AuthController::class, 'getUsers']);
    Route::post('/users', [AuthController::class, 'adminCreateUser']);
    Route::delete('/users/{user}', [AuthController::class, 'adminDeleteUser']);

    Route::get('/user', function (Request $request) {
        return $request->user();
    });
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
});
