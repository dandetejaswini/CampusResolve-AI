import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { processFirebaseClaimRequest } from './api/auth/firebase-claim.ts';
import { processWelcomeEmailRequest } from './api/auth/welcome-email.ts';
import { processWorkspaceOperationRequest } from './api/ops/workspace.ts';
import { processPolicyAssistantRequest } from './api/ai/policy-assistant.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '2mb' }));

  // Server-side Phase 2 Authentication & Welcome Email API routes
  app.all('/api/auth/firebase-claim', async (req, res) => {
    const result = await processFirebaseClaimRequest({
      method: req.method,
      headers: req.headers,
    });
    res.status(result.status).json(result.body);
  });

  app.all('/api/auth/welcome-email', async (req, res) => {
    const result = await processWelcomeEmailRequest(
      req.method,
      req.body,
      req.headers
    );
    res.status(result.status).json(result.body);
  });

  // Server-side Phase 3 Operational Workspace & AI Policy Retrieval API routes
  app.all('/api/ops/workspace', async (req, res) => {
    const result = await processWorkspaceOperationRequest(
      req.method,
      req.query as Record<string, string | string[] | undefined>,
      req.body,
      req.headers
    );
    res.status(result.status).json(result.body);
  });

  app.all('/api/ai/policy-assistant', async (req, res) => {
    const result = await processPolicyAssistantRequest(
      req.method,
      req.body,
      req.headers
    );
    res.status(result.status).json(result.body);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CampusResolve AI server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
