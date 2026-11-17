<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('customer_messages', function (Blueprint $table) {
            $table->string('source', 16)->default('contact');
            $table->string('request_key', 64)->nullable();
            $table->unsignedBigInteger('customer_last_read_entry_id')->default(0);
            $table->unsignedBigInteger('team_last_read_entry_id')->default(0);
            $table->timestamp('last_entry_at')->nullable()->index();
            $table->string('closed_by_role', 16)->nullable();
            $table->timestamp('customer_hidden_at')->nullable();
            $table->unique(['user_id', 'request_key'], 'customer_message_request_unique');
        });
        Schema::create('customer_message_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('customer_message_id')->constrained('customer_messages')->cascadeOnDelete();
            $table->foreignId('sender_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('sender_role', 16);
            $table->string('sender_name', 190);
            $table->text('body');
            $table->string('event', 24)->nullable();
            $table->string('request_key', 64)->nullable();
            $table->timestamps();
            $table->unique(['customer_message_id', 'sender_id', 'request_key'], 'customer_entry_request_unique');
            $table->index(['customer_message_id', 'id']);
        });
        Schema::create('support_knowledge_entries', function (Blueprint $table) {
            $table->id();
            $table->string('key', 80)->unique();
            $table->json('payload');
            $table->boolean('is_enabled')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });
        Schema::create('support_operator_presence', function (Blueprint $table) {
            $table->id();
            $table->foreignId('token_id')->unique()->constrained('personal_access_tokens')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('expires_at')->index();
        });

        // One original message becomes the first entry. Names, ownership and
        // timestamps are snapshots; an email address never assigns ownership.
        DB::table('customer_messages')->orderBy('id')->chunkById(200, function ($rows) {
            foreach ($rows as $row) {
                $entry = DB::table('customer_message_entries')->insertGetId([
                    'customer_message_id' => $row->id, 'sender_id' => $row->user_id,
                    'sender_role' => 'customer', 'sender_name' => $row->sender_name,
                    'body' => $row->message, 'created_at' => $row->created_at, 'updated_at' => $row->created_at,
                ]);
                DB::table('customer_messages')->where('id', $row->id)->update([
                    'last_entry_at' => $row->created_at, 'customer_last_read_entry_id' => $entry,
                    'team_last_read_entry_id' => $row->is_read ? $entry : 0,
                ]);
            }
        });
        $defaults = json_decode(file_get_contents(resource_path('support-assistant.json')), true, flags: JSON_THROW_ON_ERROR);
        DB::table('site_settings')->insertOrIgnore([
            'key' => 'support_assistant_config',
            'value' => json_encode([...$defaults['config'], 'revision' => (string) Str::uuid()], JSON_UNESCAPED_UNICODE),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        foreach ($defaults['faqs'] as $order => $faq) {
            DB::table('support_knowledge_entries')->insert([
                'key' => $faq['key'], 'payload' => json_encode($faq, JSON_UNESCAPED_UNICODE),
                'is_enabled' => true, 'sort_order' => $order, 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // A normal application rollback must not silently erase conversations.
        if (Schema::hasTable('customer_message_entries') && DB::table('customer_message_entries')->where(fn ($q) => $q->whereNotNull('request_key')->orWhereNotNull('event'))->exists()) {
            throw new RuntimeException('Support conversations exist. Export and review them before removing this storage.');
        }
        Schema::dropIfExists('support_operator_presence');
        Schema::dropIfExists('support_knowledge_entries');
        Schema::dropIfExists('customer_message_entries');
        Schema::table('customer_messages', function (Blueprint $table) {
            $table->dropUnique('customer_message_request_unique');
            $table->dropIndex('customer_messages_last_entry_at_index');
            $table->dropColumn(['source', 'request_key', 'customer_last_read_entry_id', 'team_last_read_entry_id', 'last_entry_at', 'closed_by_role', 'customer_hidden_at']);
        });
    }
};
