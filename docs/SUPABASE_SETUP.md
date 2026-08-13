# Supabase Authentication Setup

The client uses Supabase Auth for Google OAuth and `public.profiles` for the
authenticated player's display name, avatar, and administrator status. Players
can also continue as a guest without contacting Supabase; guest profiles live
only in the current browser tab. The game server verifies signed-in access
tokens with Supabase before granting any administrator capability.

## 1. Create and migrate the project

Create a Supabase project, then apply
`supabase/migrations/20260720131500_create_profiles.sql` either through your
normal Supabase CLI migration workflow or in the dashboard SQL editor. Then
apply `supabase/migrations/20260811120000_add_profile_admin.sql`.

The migration:

- creates one profile per `auth.users` row and cascades profile deletion when
  the Auth user is deleted;
- seeds new and existing profiles from Google name/avatar metadata;
- keeps `created_at` immutable and maintains `updated_at` in the database;
- allows authenticated users to read, insert, and edit only their own profile;
- restricts client writes to `display_name` and `avatar_url`;
- stores `is_admin` while preventing authenticated clients from changing it;
- denies profile access to unauthenticated clients.

Test the migration in a non-production project first. A failing Auth trigger
can prevent new users from being created.

## 2. Configure Google OAuth

1. In Google Cloud, create an OAuth 2.0 Web application.
2. Add Supabase's callback URL as an authorized redirect URI:

   ```text
   https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
   ```

3. In Supabase, enable the Google provider and enter the Google client ID and
   client secret. These values stay in the Supabase dashboard and must not be
   added to this repository.
4. In Supabase Auth URL Configuration, set the production Site URL and allow
   every client URL that may receive the completed OAuth redirect. For local
   development, allow `http://localhost:5173/**`. Add the corresponding HTTPS
   production URL before deploying.

The client redirects OAuth to its Vite base URL. After the redirect, the
Supabase browser client consumes the callback, restores the persisted session,
loads the profile, and shows the Main Menu. It never resumes directly into an
active game.

## 3. Configure the client

Copy the example environment file inside the client workspace:

```powershell
Copy-Item packages/client/.env.example packages/client/.env.local
```

Set these values in `packages/client/.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

`VITE_SERVER_URL` is optional; local development already defaults to
`ws://127.0.0.1:9001/ws`.

Only the browser-safe Supabase publishable key belongs in the client. Never use
a Supabase secret key or legacy `service_role` key in any `VITE_*` variable,
because Vite embeds those values in the public browser bundle.

Restart Vite after changing environment variables.

## 4. Configure administrator verification on the game server

For local development, the server automatically reuses the browser-safe
Supabase URL and publishable key from `packages/client/.env.local`. You can
optionally copy the server example to override those values for the server:

```powershell
Copy-Item packages/server/.env.example packages/server/.env.local
```

```dotenv
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
```

`SUPABASE_ANON_KEY` is also accepted for projects still using a legacy anon
key. A secret or `service_role` key is not required. If these settings are
missing or Supabase cannot verify a token, administrator access fails closed.

Grant administrator status only from a trusted SQL or backend context:

```sql
update public.profiles
set is_admin = true
where id = 'AUTH_USER_UUID';
```

The browser forwards its access token over the game WebSocket. Use `wss://` in
production. The server validates the token with Supabase, reads that user's own
profile through RLS, and returns the verified permission privately. Only then
does the client show the debug menu and immediate lobby-start control. The
server independently rejects debug and immediate-start messages from everyone
else.

## 5. Verify the flow

1. Start the server and client as documented in `ARCHITECTURE.md`.
2. Confirm the signed-out screen opens without a canvas or WebSocket request.
3. Sign in with Google and confirm a matching `public.profiles` row exists.
4. Reload and confirm the session returns to Main Menu.
5. Edit the display name and an optional HTTPS avatar URL, then reload to
   confirm persistence.
6. Select Join Game and confirm it only shows the lobby placeholder.
7. Select Create Game and confirm this is the first point at which PixiJS loads
   and the `/ws` connection opens.
8. Sign out from Main Menu and confirm the Auth screen returns.
9. Continue as a guest, choose a display name, and confirm no Supabase profile
   is created. Edit the guest profile, reload the tab to confirm it is restored,
   then choose Leave Guest Session and confirm the local profile is cleared.
10. Set one test profile's `is_admin` to true from trusted SQL. Confirm that
    account sees the debug menu and can start a one-player lobby immediately.
11. Confirm a regular signed-in user and a guest see neither admin control and
    cannot trigger the corresponding WebSocket actions manually.

For RLS verification, use two test users: each user must be able to select and
update only the row whose `id` equals their own Auth user ID. Neither user
should be able to modify `id`, `is_admin`, `created_at`, or `updated_at`, or
delete a row.
