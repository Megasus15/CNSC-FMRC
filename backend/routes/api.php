<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\AppointmentController;
use App\Http\Controllers\Api\AdminDashboardController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\ProductController;

Route::post('/login', [AuthController::class, 'login']);
Route::post('/register', [AuthController::class, 'register']);
Route::get('/appointments', [AppointmentController::class, 'index']);
Route::post('/appointments', [AppointmentController::class, 'store']);
Route::delete('/appointments/{appointment}', [AppointmentController::class, 'destroy']);
Route::patch('/appointments/{appointment}/archive', [AppointmentController::class, 'archive']);
Route::get('/appointments/calendar', [AppointmentController::class, 'calendar']);
Route::put('/appointments/calendar', [AppointmentController::class, 'updateCalendar']);
Route::get('/appointments/{reference}/verify', [AppointmentController::class, 'verifyByReference']);

// Public: Customer-facing products (non-blocked only)
Route::get('/products', [ProductController::class, 'index']);

Route::middleware('auth:sanctum')->group(function () {
    Route::get('/users', [AuthController::class, 'getUsers']);
    Route::post('/users', [AuthController::class, 'adminCreateUser']);
    Route::delete('/users/{user}', [AuthController::class, 'adminDeleteUser']);

    Route::get('/customer/profile', [AuthController::class, 'customerProfile']);
    Route::put('/customer/profile', [AuthController::class, 'updateCustomerProfile']);

    Route::post('/orders', [OrderController::class, 'customerStore']);
    Route::get('/customer/orders', [OrderController::class, 'customerIndex']);
    Route::get('/customer/orders/{order}', [OrderController::class, 'customerShow']);

    Route::get('/admin/orders', [OrderController::class, 'adminIndex']);
    Route::get('/admin/dashboard/summary', [AdminDashboardController::class, 'summary']);
    Route::get('/admin/orders/{order}', [OrderController::class, 'adminShow']);
    Route::post('/admin/orders/{order}/approve', [OrderController::class, 'approve']);
    Route::post('/admin/orders/{order}/reject', [OrderController::class, 'reject']);
    Route::post('/admin/orders/{order}/complete', [OrderController::class, 'complete']);
    Route::patch('/admin/orders/{order}/tracking', [OrderController::class, 'updateTracking']);
    Route::patch('/admin/orders/{order}/payment-status', [OrderController::class, 'updatePaymentStatus']);
    Route::delete('/admin/orders/{order}/payment', [OrderController::class, 'adminDestroyPayment']);
    Route::delete('/admin/orders/{order}', [OrderController::class, 'adminDestroy']);

    // Admin: Products CRUD
    Route::get('/admin/products', [ProductController::class, 'adminIndex']);
    Route::post('/admin/products', [ProductController::class, 'store']);
    Route::put('/admin/products/{product}', [ProductController::class, 'update']);
    Route::delete('/admin/products/{product}', [ProductController::class, 'destroy']);

    Route::get('/user', function (Request $request) {
        return $request->user();
    });
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::post('/change-password', [AuthController::class, 'changePassword']);
});
