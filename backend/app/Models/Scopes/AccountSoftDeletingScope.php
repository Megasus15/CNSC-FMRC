<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletingScope;

/** Keep sign-in working during a file-first release; deletion itself requires the migration. */
final class AccountSoftDeletingScope extends SoftDeletingScope
{
    public function apply(Builder $builder, Model $model)
    {
        if ($model->hasSchemaColumns(['deleted_at'])) parent::apply($builder, $model);
    }
}
