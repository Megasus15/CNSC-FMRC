<?php

use App\Http\Controllers\Api\AppointmentController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/appointments/verify/{reference}', [AppointmentController::class, 'verifyPage']);
