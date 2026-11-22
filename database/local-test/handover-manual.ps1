# Manual S2-09 handover testing on a DISPOSABLE local PostgreSQL (never Supabase).
#   -Action Setup     start container, apply 003-006 + S2-02 + C430PRJCT-40 +
#                     007 in production order, verify the combined permissions,
#                     apply S2-05 and LJ's real S2-01 permissions/status guards,
#                     create restricted service logins, and load the
#                     synthetic browser fixture
#   -Action Run       start ONE service with its own restricted DATABASE_URL;
#                     the terminal's previous values are restored on exit
#   -Action Teardown  remove the container and its temporary data
# .env.local files are never read or written; process variables take precedence
# over .env.local for the started service only.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('Setup', 'Run', 'Teardown')][string]$Action,
  [ValidateSet('users', 'equipment', 'loans')][string]$Service,
  [string]$AssistantId,
  [string]$AssistantEmail
)

$ErrorActionPreference = 'Stop'
$composeFile = Join-Path $PSScriptRoot 'compose.yaml'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = 'unitrack-handover-manual'

function Invoke-Psql([string[]]$arguments, [string]$step) {
  docker compose --project-name $project --file $composeFile exec -T postgres `
    psql -X --set ON_ERROR_STOP=1 --username unitrack_local_test --dbname unitrack_test @arguments
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit code $LASTEXITCODE." }
}

switch ($Action) {
  'Setup' {
    if ($AssistantId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') {
      throw 'Pass -AssistantId with your Supabase Auth user ID (a UUID).'
    }
    if ([string]::IsNullOrWhiteSpace($AssistantEmail)) { throw 'Pass -AssistantEmail with that account''s university email.' }
    # Any existing container (running OR stopped) may predate the current
    # migrations; refuse to reuse it.
    if (docker compose --project-name $project --file $composeFile ps --all -q) {
      throw 'A manual test database container already exists (running or stopped). Run -Action Teardown first.'
    }
    docker compose --project-name $project --file $composeFile up --detach --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Docker PostgreSQL startup failed.' }
    foreach ($migration in @(
        '003_equipment_request_fingerprint', '004_loans_return_operation',
        '005_equipment_operation_guard', '006_service_database_isolation',
        'S2-02_no_double_booking', 'C430PRJCT-40_S2-09_handover_confirmation')) {
      Invoke-Psql @('--quiet', '--file', "/workspace/database/migrations/$migration.sql") "Migration $migration"
    }
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_S2-02.sql') 'S2-02 verification'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_C430PRJCT-40.sql') 'S2-09 verification before 007'
    Invoke-Psql @('--file', '/workspace/database/local-test/prepare_007_legacy.sql') 'Migration 007 legacy fixture'
    Invoke-Psql @('--quiet', '--file', '/workspace/database/migrations/007_custody_record_protection.sql') 'Migration 007 custody protection'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_007.sql') 'Migration 007 verification'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_C430PRJCT-40.sql') 'S2-09 verification after 007'
    Invoke-Psql @('--file', '/workspace/database/migrations/S2-05_kit_management.sql') 'Migration S2-05'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_S2-05.sql') 'S2-05 verification'
    Invoke-Psql @('--file', '/workspace/database/migrations/S2-01_reservation_permissions.sql') 'Migration S2-01 permissions'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_S2-01.sql') 'S2-01 verification'
    Invoke-Psql @('--file', '/workspace/database/migrations/S2-01_reservation_status_protection.sql') 'C3/C4 status protection'
    Invoke-Psql @('--file', '/workspace/database/local-test/verify_S2-01_status_protection.sql') 'C3/C4 verification'
    Invoke-Psql @('--file', '/workspace/database/local-test/manual_service_logins.sql') 'Restricted service logins'
    Invoke-Psql @('--set', "assistant_id=$AssistantId", '--set', "assistant_email=$AssistantEmail",
      '--file', '/workspace/database/local-test/handover_manual_fixture.sql') 'Synthetic handover fixture'
    # Prove the restricted Loans LOGIN can mark reservations fulfilled, and nothing broader.
    Invoke-Psql @('--file', '/workspace/database/local-test/manual_fulfilment_permission_check.sql') 'Fulfilment permission check'
    Push-Location $repositoryRoot
    try { npm run build:packages; if ($LASTEXITCODE -ne 0) { throw 'Shared package build failed.' } }
    finally { Pop-Location }
    Write-Host 'Setup complete. The real S2-01 grant and C3/C4 guards are installed. Start each service in its own terminal with -Action Run -Service users|equipment|loans.'
  }
  'Run' {
    if (-not $Service) { throw 'Pass -Service users, equipment or loans.' }
    $names = @('DATABASE_URL', 'LOANS_DATABASE_SESSION_AFFINITY', 'USERS_SERVICE_URL')
    $previous = @{}
    foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    Push-Location $repositoryRoot
    try {
      # Each service connects as its OWN restricted login (migration 006 groups).
      $env:DATABASE_URL = "postgresql://unitrack_${Service}_local:local_test_only@127.0.0.1:55432/unitrack_test"
      if ($Service -eq 'loans') {
        $env:LOANS_DATABASE_SESSION_AFFINITY = 'confirmed'
        # S2-09 borrower verification calls Users; only set when not configured.
        if (-not $env:USERS_SERVICE_URL) { $env:USERS_SERVICE_URL = 'http://localhost:3001' }
      }
      Write-Host "Starting $Service as unitrack_${Service}_local (press Ctrl+C to stop)..."
      npm run dev --workspace=@unitrack/$Service
      if ($LASTEXITCODE -ne 0) {
        Write-Host "$Service stopped (exit $LASTEXITCODE). If Next.js only showed its one-time upgrade notice, run the same command again."
      }
    }
    finally {
      Pop-Location
      foreach ($name in $names) {
        if ($null -eq $previous[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $previous[$name] }
      }
      Write-Host 'Restored this terminal''s DATABASE_URL, LOANS_DATABASE_SESSION_AFFINITY and USERS_SERVICE_URL.'
    }
  }
  'Teardown' {
    docker compose --project-name $project --file $composeFile down --volumes --remove-orphans
    Write-Host 'Removed the manual test database and its temporary data.'
  }
}
