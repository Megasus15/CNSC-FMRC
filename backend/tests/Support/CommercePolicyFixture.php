<?php

namespace Tests\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class CommercePolicyFixture
{
    public static function version(): string
    {
        $version = DB::table('commerce_policy_settings')->where('id', 1)->value('published_version');
        if ($version) {
            return $version;
        }
        $version = (string) Str::uuid();
        DB::table('commerce_policies')->insert(['version' => $version, 'title' => 'Approved test policy',
            'terms_text' => 'Approved fixture terms used only by isolated checkout tests.',
            'refund_text' => 'Approved fixture refund wording used only by isolated checkout tests.',
            'published_by' => 0, 'published_at' => now()]);
        DB::table('commerce_policy_settings')->where('id', 1)->update(['published_version' => $version]);

        return $version;
    }

    public static function acceptance(): array
    {
        return ['policy_version' => self::version(), 'policy_accepted' => true];
    }
}
