/**
 * P1-T1 — Express app (kept free of DB/network side effects at import time so
 * integration tests can import it and drive it with Supertest against
 * mongodb-memory-server — see implementation.md §17).
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import env from './config/env.js';
import requestLogger from './middleware/requestLogger.js';
import errorHandler from './middleware/errorHandler.js';
import { setProvider } from './lib/visionClassificationService.js';
import { groqProvider } from './lib/visionProvider.js';
import healthRouter from './routes/health.js';
import authRouter from './modules/auth/authRoutes.js';
import itemsRouter from './modules/items/itemsRoutes.js';
import swapsRouter from './modules/swaps/swapRoutes.js';
import adminRouter from './modules/admin/adminRoutes.js';
import usersRouter from './modules/users/usersRoutes.js';

const app = express();

app.set('trust proxy', 1); // behind Railway/Render/Vercel proxies in deployment
app.disable('x-powered-by');

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN, // scoped list, never '*' (§18/§P9-T4)
    credentials: true, // refresh-token cookie (§11)
  })
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// §15 NoSQL-injection row: handled by Mongoose's global `sanitizeFilter`
// (set in server.js before any query can run) + Yup validation on request
// bodies. NOTE: express-mongo-sanitize was removed — it mutates req.query,
// which is a read-only getter in Express 5 and crashed every request.

app.use(requestLogger);

// P6-T2: register the concrete vision provider (Groq) at boot. Without a
// GROQ_API_KEY the adapter reports unconfigured and classify() resolves null
// — the advisory-only degradation, never an error (§14.4/§16).
if (groqProvider.isConfigured()) {
  setProvider(groqProvider);
}

app.use('/health', healthRouter);

// API v1 (§10).
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/items', itemsRouter);
app.use('/api/v1', swapsRouter); // /items/:id/swap-requests + /swap-requests*
app.use('/api/v1/admin', adminRouter); // requireAuth + requireAdmin inside (P3-T5 convention)
app.use('/api/v1/users', usersRouter); // requireAuth inside (P3-T5 convention)

// Module routers (items, swaps, admin) mount here from Phase 4 onward.

// 404 — after all routes, before the error handler.
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } });
});

app.use(errorHandler);

export default app;
