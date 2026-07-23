# Roles and permissions (RBAC)

Access control for the staff-facing parts of the system (employee redemption app
and admin dashboard). The rules live in `lib/permissions/roles.ts` and are
**enforced server-side** by `assertPermission()` (`lib/auth/guards.ts`).

Customers and recipients are account-less — they never authenticate. RBAC applies
only to Just A Second staff.

---

## 1. The six roles

Defined by the `Role` type in `lib/permissions/roles.ts`; Hebrew labels come from
`ROLE_LABEL_HE`.

| Role | Hebrew (`ROLE_LABEL_HE`) | Description |
| --- | --- | --- |
| `owner` | בעלים | The business owner. Full permission set. |
| `admin` | מנהל מערכת | System administrator. Same full operational set as owner (owner-only distinctions like transferring ownership are not modeled in the MVP). |
| `store_manager` | מנהל חנות | Runs a store: can redeem and **reverse** redemptions, read cards, add notes, manage employees, read the audit log. No finance or balance-mutation powers. |
| `store_employee` | עובד חנות | Till staff: can perform redemptions and read cards. Nothing else. |
| `finance` | כספים | Finance/bookkeeping: read cards, view finance, export financial data, read audit. No redemption. |
| `read_only` | צפייה בלבד | Auditor/observer: read cards and read audit only. |

`ROLES` exports the list in this order.

---

## 2. The `Permission` enum

The `Permission` union in `lib/permissions/roles.ts`:

- **Redemption:** `redemption:perform`, `redemption:reverse`
- **Gift-card management:** `giftcard:read`, `giftcard:resend`,
  `giftcard:edit_recipient`, `giftcard:suspend`, `giftcard:cancel`,
  `giftcard:reissue`, `giftcard:adjust_balance`, `giftcard:refund`,
  `giftcard:add_note`
- **Templates + settings:** `template:manage`, `settings:manage`
- **People:** `employee:manage`
- **Finance:** `finance:view`, `export:financial`
- **Audit:** `audit:read`

---

## 3. Role → permission matrix

Straight from `ROLE_PERMISSIONS` in `lib/permissions/roles.ts` (`owner` and
`admin` share the full set `OWNER_PERMS`).

| Permission | owner | admin | store_manager | store_employee | finance | read_only |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| `redemption:perform` | ✓ | ✓ | ✓ | ✓ | | |
| `redemption:reverse` | ✓ | ✓ | ✓ | | | |
| `giftcard:read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `giftcard:resend` | ✓ | ✓ | | | | |
| `giftcard:edit_recipient` | ✓ | ✓ | | | | |
| `giftcard:suspend` | ✓ | ✓ | | | | |
| `giftcard:cancel` | ✓ | ✓ | | | | |
| `giftcard:reissue` | ✓ | ✓ | | | | |
| `giftcard:adjust_balance` | ✓ | ✓ | | | | |
| `giftcard:refund` | ✓ | ✓ | | | | |
| `giftcard:add_note` | ✓ | ✓ | ✓ | | | |
| `template:manage` | ✓ | ✓ | | | | |
| `settings:manage` | ✓ | ✓ | | | | |
| `employee:manage` | ✓ | ✓ | ✓ | | | |
| `finance:view` | ✓ | ✓ | | | ✓ | |
| `export:financial` | ✓ | ✓ | | | ✓ | |
| `audit:read` | ✓ | ✓ | ✓ | | ✓ | ✓ |

Helpers: `permissionsForRole(role)`, `hasPermission(role, permission)`,
`hasAnyRole(role, allowed)`.

---

## 4. Enforcement is server-side

**Hiding a UI button is never authorization.** The UI may read
`hasPermission(...)` to hide controls, but every protected server action and route
handler independently calls `assertPermission()` (`lib/auth/guards.ts`), which:

1. Loads the current user (`getCurrentUser`, `lib/auth/session.ts`).
2. Throws `AuthorizationError` if there is no user, or if
   `hasPermission(user.role, permission)` is false.
3. Returns the `AppUser` so the caller can record the actor in the audit log.

`requireUser` / `requireRole` guard whole pages by redirecting unauthenticated or
under-privileged visitors to the login page. These guards run in the server
actions under `app/employee/actions.ts` and `app/admin/actions.ts`.

**Production:** Supabase **Auth + RLS** scoped by `user_roles` — RLS on every
table enforces the same boundaries at the database level (see
`docs/redemption-security.md` §5 and `supabase/migrations/0002_rls.sql`).

**Local dev:** a **demo cookie auth** layer under `lib/auth` (`session.ts`,
`users.ts`) stands in for Supabase Auth, backed by a fixed directory of demo
accounts.

---

## 5. Demo accounts (local development only)

From `lib/auth/users.ts` (`DEMO_USER_LIST`). **All share the password
`password`** (`DEMO_PASSWORD`) — for local development only.

| Email | Role | Name |
| --- | --- | --- |
| `owner@justasecond.example` | owner | נעה ברנט |
| `admin@justasecond.example` | admin | אדמין |
| `manager@justasecond.example` | store_manager | מנהל חנות |
| `employee1@justasecond.example` | store_employee | עובד/ת א׳ |
| `employee2@justasecond.example` | store_employee | עובד/ת ב׳ |
| `finance@justasecond.example` | finance | כספים |

These accounts exist only in the offline auth layer. In production they must not
exist — real staff are provisioned through Supabase Auth + `user_roles`, and all
dev secrets (including `AUTH_SECRET`) are rotated (see
`docs/production-checklist.md`).
