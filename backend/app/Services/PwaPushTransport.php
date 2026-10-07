<?php

namespace App\Services;

use App\Support\Pwa;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

class PwaPushTransport
{
    public function send(object $device, array $payload): array
    {
        if (! Pwa::validEndpoint($device->endpoint)) {
            return ['success' => false, 'expired' => true, 'status' => 400];
        }
        $push = new WebPush(['VAPID' => [
            'subject' => config('pwa.vapid.subject'), 'publicKey' => config('pwa.vapid.public_key'),
            'privateKey' => config('pwa.vapid.private_key'),
        ]], ['TTL' => 3600, 'urgency' => 'high'], 10, ['allow_redirects' => false, 'connect_timeout' => 5]);
        // This payload contains only the app, update category and inbox reference.
        $report = $push->sendOneNotification(Subscription::create([
            'endpoint' => $device->endpoint, 'keys' => ['p256dh' => $device->p256dh, 'auth' => $device->auth],
        ]), json_encode($payload));

        return ['success' => $report->isSuccess(), 'expired' => $report->isSubscriptionExpired(),
            'status' => $report->getResponse()?->getStatusCode() ?? 0];
    }
}
