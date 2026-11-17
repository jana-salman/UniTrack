# UniTrack local setup

These instructions start Web, Users, Equipment, and Loans on ports 3000-3003.
Never commit `.env.local`, database URLs, JWT secrets, or credential bundles.

## 1. Update the repository

```powershell
git switch main
git pull --ff-only origin main
```

## 2. Create local environment files

Run this only when the destination files do not already exist. It refuses to
overwrite an existing local configuration.

```powershell
$copies = @{
  'apps/web/.env.example' = 'apps/web/.env.local'
  'services/users/.env.example' = 'services/users/.env.local'
  'services/equipment/.env.example' = 'services/equipment/.env.local'
  'services/loans/.env.example' = 'services/loans/.env.local'
}

foreach ($source in $copies.Keys) {
  $destination = $copies[$source]
  if (Test-Path -LiteralPath $destination) {
    throw "$destination already exists; refusing to overwrite it."
  }
  Copy-Item -LiteralPath $source -Destination $destination
}
```

Obtain the project publishable key from a trusted teammate or the Supabase
project dashboard and place it in Web only. Web must not have `DATABASE_URL`.

## 3. Add the restricted database URLs

The project owner shares these values privately, preferably with expiring,
view-once password-manager links. Paste each URL only into its matching file:

- Users URL (`unitrack_users_dev`, transaction pooler port 6543) ->
  `services/users/.env.local`
- Equipment URL (`unitrack_equipment_dev`, transaction pooler port 6543) ->
  `services/equipment/.env.local`
- Loans URL (`unitrack_loans_dev`, session pooler port 5432) ->
  `services/loans/.env.local`

Do not reuse one service's URL in another service.

## 4. Generate one shared local JWT secret

This PowerShell command generates 256 random bits and copies the result to the
clipboard without printing it:

```powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
Set-Clipboard -Value $secret
[Array]::Clear($bytes, 0, $bytes.Length)
Remove-Variable secret
```

Paste that same value as `INTERNAL_JWT_SECRET` in all four `.env.local` files,
then clear the clipboard:

```powershell
Set-Clipboard -Value ''
```

## 5. Install and start

From the repository root:

```powershell
npm ci
npm run dev:all
```

`dev:all` starts Web on 3000, Users on 3001, Equipment on 3002, and Loans on
3003. Press `Ctrl+C` to stop the four-process group.

## 6. Verify health

With `dev:all` running, execute in another terminal:

```powershell
$healthEndpoints = @(
  'http://localhost:3000/health',
  'http://localhost:3001/health',
  'http://localhost:3002/health',
  'http://localhost:3003/health'
)

foreach ($endpoint in $healthEndpoints) {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $endpoint
  "$endpoint -> $($response.StatusCode)"
}
```

All four endpoints should return HTTP 200. Protected API routes return HTTP 401
until the request has a valid Supabase user session or signed internal token.
