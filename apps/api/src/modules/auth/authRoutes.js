/**
 * Auth routes (§10): POST /auth/register (P3-T1). Login/refresh/logout/me
 * mount here in P3-T2..P3-T4.
 */

import { Router } from 'express';
import { loginSchema, registerSchema } from '@rewear/shared-schemas';

import validate from '../../middleware/validate.js';
import requireAuth from '../../middleware/requireAuth.js';
import { loginLimiter, registerLimiter } from '../../middleware/rateLimit.js';
import { login, logout, me, refresh, register } from './authController.js';

const router = Router();

// §11: limiters run BEFORE validation so garbage-payload spam counts too.
router.post('/register', registerLimiter, validate(registerSchema), register);
router.post('/login', loginLimiter, validate(loginSchema), login);
router.post('/refresh', refresh); // auth via httpOnly cookie — no body to validate
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);

export default router;
