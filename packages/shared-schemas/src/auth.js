/**
 * Auth validation schemas (implementation.md §8, §11).
 * Hand-written Yup schemas shared by @rewear/api (server-side enforcement)
 * and @rewear/web (P3-T7 form validation) so the rules never drift.
 */

import { object, string } from 'yup';

import { optionalPhoneSchema } from './phone.js';

export const registerSchema = object({
  name: string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80)
    .required('Name is required'),
  email: string()
    .trim()
    .lowercase() // emails are stored/compared lowercase (§10 unique index)
    .email('Please enter a valid email address')
    .required('Email is required'),
  password: string()
    .min(8, 'Password must be at least 8 characters') // §11: min 8, server-side
    .max(128)
    .required('Password is required'),
  // Contact reveal (user-requested): optional profile phone, volunteered at
  // signup. Revealed to a swap counterparty ONLY when a swap is ACCEPTED —
  // never on public item detail (owner projection is an explicit field list).
  phone: optionalPhoneSchema,
});

export const loginSchema = object({
  email: string()
    .trim()
    .lowercase()
    .email('Please enter a valid email address')
    .required('Email is required'),
  password: string().required('Password is required'),
});
