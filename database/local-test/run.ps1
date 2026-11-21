[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectName = 'unitrack-migration-test'
$databaseUrl = 'postgresql://unitrack_local_test:local_test_only@127.0.0.1:55432/unitrack_test'
$containerStarted = $false

function Assert-LastExitCode([string]$step) {
  if ($LASTEXITCODE -ne 0) {
    throw "$step failed with exit code $LASTEXITCODE."
  }
}
function Invoke-PsqlFile([string]$path, [string]$step) {
  docker compose --project-name $projectName --file $composeFile exec -T postgres `
    psql -X --set ON_ERROR_STOP=1 --username unitrack_local_test `
    --dbname unitrack_test --file $path
  Assert-LastExitCode $step
}
function Invoke-PsqlGitFile([string]$revisionPath, [string]$step) {
  # Use the immutable teammate commit directly for the disposable DB run. This
  # does not check out, copy, or modify teammate-owned files in this worktree.
  git show $revisionPath | docker compose --project-name $projectName --file $composeFile exec -T postgres `
    psql -X --set ON_ERROR_STOP=1 --username unitrack_local_test `
    --dbname unitrack_test
  Assert-LastExitCode $step
}

try {
  Write-Host 'Starting disposable PostgreSQL on 127.0.0.1:55432...'
  # Request cleanup before startup so a partial create/start failure cannot
  # leave this explicitly named local project behind.
  $containerStarted = $true
  docker compose --project-name $projectName --file $composeFile up --detach --wait postgres
  Assert-LastExitCode 'Docker PostgreSQL startup'

  Write-Host 'Running the existing read-only preflight against the synthetic baseline...'
  $preflight = docker compose --project-name $projectName --file $composeFile exec -T postgres `
    psql -X --set ON_ERROR_STOP=1 --tuples-only --no-align --field-separator '|' `
    --username unitrack_local_test --dbname unitrack_test `
    --file /workspace/database/verification/preflight_003_005.sql
  Assert-LastExitCode 'Read-only preflight'
  $preflight | ForEach-Object { Write-Host $_ }
  $preflightText = $preflight -join "`n"
  if ($preflightText -notmatch '(?m)^MIGRATION\|00_OVERALL_MIGRATION_GATE\|PASS\|' -or
      $preflightText -notmatch '(?m)^RUNTIME\|00_OVERALL_RUNTIME_GATE\|PASS\|') {
    throw 'The existing preflight did not return PASS for both overall gates.'
  }

  Write-Host 'Applying and verifying migration 003 locally...'
  Invoke-PsqlFile '/workspace/database/migrations/003_equipment_request_fingerprint.sql' 'Migration 003'
  Invoke-PsqlFile '/workspace/database/local-test/verify_003.sql' 'Migration 003 verification'

  Write-Host 'Applying and verifying migration 004 locally...'
  Invoke-PsqlFile '/workspace/database/migrations/004_loans_return_operation.sql' 'Migration 004'
  Invoke-PsqlFile '/workspace/database/local-test/verify_004.sql' 'Migration 004 verification'

  Write-Host 'Applying and verifying migration 005 locally...'
  Invoke-PsqlFile '/workspace/database/migrations/005_equipment_operation_guard.sql' 'Migration 005'
  Invoke-PsqlFile '/workspace/database/local-test/verify_005.sql' 'Migration 005 verification'

  Write-Host 'Applying and verifying migration 006 service isolation locally...'
  Invoke-PsqlFile '/workspace/database/migrations/006_service_database_isolation.sql' 'Migration 006'
  Invoke-PsqlFile '/workspace/database/local-test/verify_006.sql' 'Migration 006 verification'

  Write-Host 'Applying and verifying migration S2-02 locally...'
  Invoke-PsqlFile '/workspace/database/migrations/S2-02_no_double_booking.sql' 'Migration S2-02'
  Invoke-PsqlFile '/workspace/database/local-test/verify_S2-02.sql' 'Migration S2-02 verification'

  Write-Host 'Applying teammate S2-09 migration from its remote-tracking commit...'
  Invoke-PsqlGitFile 'origin/feature/s2-09-handover-nh-v2:database/migrations/C430PRJCT-40_S2-09_handover_confirmation.sql' 'Migration S2-09'
  Invoke-PsqlGitFile 'origin/feature/s2-09-handover-nh-v2:database/migrations/C430PRJCT-40_S2-09_handover_confirmation.sql' 'Migration S2-09 idempotency'
  Invoke-PsqlGitFile 'origin/feature/s2-09-handover-nh-v2:database/local-test/verify_C430PRJCT-40.sql' 'Migration S2-09 verification'
  Invoke-PsqlFile '/workspace/database/local-test/verify_S2-02.sql' 'Migration S2-02 re-verification'

  Write-Host 'Seeding a legacy returned loan before migration 007...'
  Invoke-PsqlFile '/workspace/database/local-test/prepare_007_legacy.sql' 'Migration 007 legacy fixture'

  Write-Host 'Applying migration 007 custody protection locally...'
  Invoke-PsqlFile '/workspace/database/migrations/007_custody_record_protection.sql' 'Migration 007 custody protection'

  Write-Host 'Verifying migration 007 custody protection locally...'
  Invoke-PsqlFile '/workspace/database/local-test/verify_007.sql' 'Migration 007 verification'

  Write-Host 'Applying S2-05 kit integrity and reservation resource migration locally...'
  Invoke-PsqlFile '/workspace/database/migrations/S2-05_kit_management.sql' 'Migration S2-05'
  Invoke-PsqlFile '/workspace/database/local-test/verify_S2-05.sql' 'Migration S2-05 verification'

  Write-Host 'Applying and verifying the staged S2-01 reservation permissions locally...'
  Invoke-PsqlFile '/workspace/database/migrations/S2-01_reservation_permissions.sql' 'Migration S2-01'
  Invoke-PsqlFile '/workspace/database/local-test/verify_S2-01.sql' 'Migration S2-01 verification'

  Write-Host 'Applying and verifying C3/C4 reservation status protection locally...'
  Invoke-PsqlFile '/workspace/database/migrations/S2-01_reservation_status_protection.sql' 'Reservation status protection migration'
  Invoke-PsqlFile '/workspace/database/local-test/verify_S2-01_status_protection.sql' 'Reservation status protection verification'

  Push-Location $repositoryRoot
  try {
    Write-Host 'Running the existing static migration compatibility test...'
    npm test --workspace=@unitrack/equipment -- --run tests/migration-compatibility.test.ts
    Assert-LastExitCode 'Static migration compatibility test'

    $previousTestDatabaseUrl = $env:UNITRACK_TEST_DATABASE_URL
    $env:UNITRACK_TEST_DATABASE_URL = $databaseUrl
    try {
      Write-Host 'Running real PostgreSQL Equipment/Loans integration tests...'
      npm test --workspace=@unitrack/equipment -- --run tests/postgres-kits.integration.test.ts
      Assert-LastExitCode 'PostgreSQL kit integration test'

      npm test --workspace=@unitrack/loans -- --run tests/postgres-migrations.integration.test.ts
      Assert-LastExitCode 'PostgreSQL microservice integration test'

      npm test --workspace=@unitrack/loans -- --run tests/postgres-reservations.integration.test.ts
      Assert-LastExitCode 'PostgreSQL reservation integration test'

      npm test --workspace=@unitrack/loans -- --run tests/postgres-reservation-status-guard.integration.test.ts
      Assert-LastExitCode 'PostgreSQL reservation status guard integration test'

    }
    finally {
      if ($null -eq $previousTestDatabaseUrl) {
        Remove-Item Env:UNITRACK_TEST_DATABASE_URL -ErrorAction SilentlyContinue
      }
      else {
        $env:UNITRACK_TEST_DATABASE_URL = $previousTestDatabaseUrl
      }
    }
  }
  finally {
    Pop-Location
  }

  Write-Host 'PASS: migrations 003-007, S2-01, S2-02, S2-05, S2-09 schema integration and C3/C4 status protection, plus focused local integration checks, passed.'
}
finally {
  if ($containerStarted) {
    Write-Host 'Removing the disposable PostgreSQL container and temporary data...'
    docker compose --project-name $projectName --file $composeFile down --volumes --remove-orphans
  }
}
