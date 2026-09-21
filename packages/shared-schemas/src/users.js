/**
 * Profile self-service schemas (§10 PATCH /users/me).
 *
 * Two-side validation like every other shared schema: the web form resolves
 * against THIS object and the API validates the same rules behind the validate
 * middleware — the rules cannot drift.
 *
 * Password-change design: a password change requires the CURRENT password
 * (re-authentication, the standard anti-session-hijack guard) while a plain
 * name/phone edit does not. The field is named `currentPassword` (never
 * `password`) so a client can never smuggle the new password into the field
 * the old one is checked against; `password` stays OPTIONAL and, when absent,
 * the service simply does not touch the credential.
 *
 * `email` is deliberately ABSENT — it is the account identifier and is not
 * user-editable at this scope; unknown keys are stripped by the validate
 * middleware anyway, so a client-sent email is silently ignored (same trust
 * model as item pointValue/ownerId).
 */

import { object, string } from 'yup';

import { optionalPhoneSchema } from './phone.js';

export const profileUpdateSchema = object({
  name: string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Name must be at most 80 characters')
    .required('Name is required'),
  // Optional, but if present must be a REAL dialable number (shared 3-layer
  // validator: structure → junk heuristics → libphonenumber numbering plan).
  // '' clears the stored phone (same optional-field contract as signup).
  phone: optionalPhoneSchema,
  // Optional new password; when present it must meet the same strength rule
  // as registration (§11: min 8, max 128 — shared rule with registerSchema).
  // The '' → undefined transform is LOAD-BEARING: Yup's validators skip only
  // undefined, so a form's always-present blank string would otherwise fail
  // .min(8) and block EVERY save (caught live by the profile test suite).
  // Same contract for currentPassword.
  password: string()
    .notRequired()
    .transform((v) => (v === '' ? undefined : v))
    .min(8, 'New password must be at least 8 characters')
    .max(128, 'New password must be at most 128 characters')
    .test(
      'no-trailing-space',
      'Password cannot start or end with a space',
      (v) => v == null || v === '' || (v === v.trim() && !/^\s|\s$/.test(v))
    ),
  currentPassword: string()
    .notRequired()
    .transform((v) => (v === '' ? undefined : v))
    .when('password', {
      is: (v) => Boolean(v && v.length > 0),
      then: (s) => s.required('Enter your current password to change it'),
      otherwise: (s) => s.notRequired(),
    }),
});

/** Whitelist of fields the service will ever persist from this payload. */
export const PROFILE_EDITABLE_FIELDS = ['name', 'phone', 'password', 'currentPassword'];
