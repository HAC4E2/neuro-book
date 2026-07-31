#!/usr/bin/env bun
import {applyAppSqliteMigrations} from "nbook/scripts/db/app-sqlite-migrations";

const result = await applyAppSqliteMigrations();
for (const migrationId of result.appliedMigrationIds) {
    console.log(`Applied SQLite migration ${migrationId}`);
}
