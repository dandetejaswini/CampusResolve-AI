import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActorRole } from '../types/domain';
import {
  processWorkspaceOperationRequest,
  extractQuery,
  extractBody,
  sendServerlessResponse,
} from '../../api/ops/workspace';
import { authorizedJsonFetch } from './workspaceClient';
import { triggerWelcomeEmailIfEligible } from './identityService';

describe('CampusResolve AI — Workspace Serverless & Provisioning Regression Suite', () => {
  const learnerProfile = {
    id: 'f9a2b3c4-1111-4000-8000-000000000001',
    auth_provider: 'firebase_google' as const,
    provider_subject: 'firebase-user-9999',
    verified_email: 'tejaswinidande2905@gmail.com',
    display_name: 'Tejaswini Dande',
    department: 'Computer Science',
    office_or_cohort: 'Class of 2026',
    actor_role: ActorRole.Learner,
    account_status: 'active',
  };

  function createMockSupabaseClient() {
    const requesters: any[] = [];
    const roles: any[] = [
      { role_id: 'ROLE-LEARNER', role_name: 'Learner' },
      { role_id: 'ROLE-INSTRUCTOR', role_name: 'Instructor' },
    ];
    const terms: any[] = [
      { term_id: 'TERM-2026-FALL', term_code: 'FA26', lifecycle_state: 'active' },
    ];

    const client: any = {
      from: (table: string) => {
        let selectedFields = '*';
        let filters: Array<{ col: string; op: string; val: any }> = [];
        let limitCount = 100;
        let updateData: any = null;

        const builder: any = {
          select: (fields: string = '*') => {
            selectedFields = fields;
            return builder;
          },
          eq: (col: string, val: any) => {
            filters.push({ col, op: 'eq', val });
            return builder;
          },
          or: (expr: string) => {
            return builder;
          },
          order: () => builder,
          limit: (n: number) => {
            limitCount = n;
            return builder;
          },
          insert: (row: any) => {
            const list = Array.isArray(row) ? row : [row];
            if (table === 'requesters') {
              requesters.push(...list);
            }
            return {
              select: () => ({
                single: async () => ({ data: list[0], error: null }),
                maybeSingle: async () => ({ data: list[0], error: null }),
              }),
            };
          },
          update: (data: any) => {
            updateData = data;
            return builder;
          },
          upsert: (rows: any) => {
            return {
              select: () => ({
                single: async () => ({ data: Array.isArray(rows) ? rows[0] : rows, error: null }),
              }),
            };
          },
          maybeSingle: async () => {
            let src = table === 'requesters' ? requesters : table === 'roles' ? roles : table === 'terms' ? terms : [];
            for (const f of filters) {
              src = src.filter((item) => item[f.col] === f.val);
            }
            if (updateData && src[0]) {
              Object.assign(src[0], updateData);
              return { data: src[0], error: null };
            }
            return { data: src[0] || null, error: null };
          },
          single: async () => {
            let src = table === 'requesters' ? requesters : table === 'roles' ? roles : table === 'terms' ? terms : [];
            for (const f of filters) {
              src = src.filter((item) => item[f.col] === f.val);
            }
            return { data: src[0] || null, error: null };
          },
        };
        return builder;
      },
    };
    return { client, requesters };
  }

  // Regression Test 1: Workspace bootstrap returns valid JSON on success
  it('Regression 1: Workspace bootstrap returns valid JSON with 200 status', async () => {
    const { client } = createMockSupabaseClient();
    const res = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      {},
      { profile: learnerProfile, client, serviceRoleClient: client }
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.ok(res.body.requester, 'Requester must be provisioned and returned');
    assert.ok(res.body.requester.requester_id.startsWith('REQ-USR-'), 'Requester ID formatted correctly');
    assert.ok(res.body.metrics, 'Metrics must be returned');
    assert.ok(Array.isArray(res.body.tickets), 'Tickets must be returned as an array');
  });

  // Regression Test 2: Workspace bootstrap returns structured JSON on failure
  it('Regression 2: Workspace bootstrap returns structured JSON on missing auth', async () => {
    const res = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      {}
    );

    assert.equal(res.status, 401);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'UNAUTHORIZED');
    assert.ok(typeof res.body.message === 'string');
  });

  // Regression Test 3: Non-JSON Vercel error responses are handled safely
  it('Regression 3: Non-JSON Vercel HTML/plain text 500 error does not throw SyntaxError "Unexpected token A"', async () => {
    const mockVercelCrashFetch = async () => {
      return new Response('A server error has occurred\nFUNCTION_INVOCATION_FAILED', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: { 'Content-Type': 'text/plain' },
      });
    };

    await assert.rejects(
      async () => {
        await authorizedJsonFetch('/api/ops/workspace?action=bootstrap', {}, mockVercelCrashFetch as any);
      },
      (err: Error) => {
        assert.ok(!err.message.includes('Unexpected token'), 'Must not leak raw JSON parsing syntax error');
        assert.ok(err.message.includes('HTTP 500') || err.message.includes('server error'));
        return true;
      }
    );
  });

  // Regression Test 4: Serverless API query, body, and response handlers work reliably
  it('Regression 4: Serverless API helpers handle custom query objects, streams, and 204 status', async () => {
    const reqWithUrl = { url: '/api/ops/workspace?action=bootstrap&kbPage=2' };
    const parsedQuery = extractQuery(reqWithUrl);
    assert.equal(parsedQuery.action, 'bootstrap');
    assert.equal(parsedQuery.kbPage, '2');

    let responseStatus = 0;
    let responseBody = '';
    const mockRes = {
      statusCode: 200,
      setHeader: () => {},
      end: (data?: string) => {
        responseStatus = mockRes.statusCode;
        responseBody = data || '';
      },
    };

    sendServerlessResponse(mockRes, 204, null);
    assert.equal(responseStatus, 204);
    assert.equal(responseBody, '');

    sendServerlessResponse(mockRes, 200, { ok: true, test: 123 });
    assert.equal(responseStatus, 200);
    assert.deepEqual(JSON.parse(responseBody), { ok: true, test: 123 });
  });

  // Regression Test 7 & 8: First-time requester provisioning succeeds and returning-user provisioning is idempotent
  it('Regression 7 & 8: First-time provisioning creates requester and returning user does not duplicate', async () => {
    const { client, requesters } = createMockSupabaseClient();

    // Run 1: First-time provisioning
    const res1 = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      {},
      { profile: learnerProfile, client, serviceRoleClient: client }
    );
    assert.equal(res1.status, 200);
    assert.equal(requesters.length, 1);
    const assignedId = res1.body.requester.requester_id;

    // Run 2: Returning user
    const res2 = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      {},
      { profile: learnerProfile, client, serviceRoleClient: client }
    );
    assert.equal(res2.status, 200);
    assert.equal(res2.body.requester.requester_id, assignedId, 'Same requester ID must be returned');
    assert.equal(requesters.length, 1, 'Must NOT create duplicate requester records');
  });

  // Regression Test 9: Missing role or term references are handled gracefully
  it('Regression 9: Resolves fallback term TERM-2026-FALL and canonical role gracefully', async () => {
    const { client } = createMockSupabaseClient();
    const instructorProfile = {
      ...learnerProfile,
      id: 'f9a2b3c4-2222-4000-8000-000000000002',
      actor_role: ActorRole.Instructor,
      display_name: 'Dr. Jane Smith',
    };

    const res = await processWorkspaceOperationRequest(
      'GET',
      { action: 'bootstrap' },
      undefined,
      {},
      { profile: instructorProfile, client, serviceRoleClient: client }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.requester.role_id, 'ROLE-INSTRUCTOR');
    assert.equal(res.body.requester.primary_term_id, 'TERM-2026-FALL');
  });

  // Regression Test 12 & 13: Welcome email does not expose sender/recipient addresses and handles already_sent
  it('Regression 12 & 13: Welcome email delivers clean message without exposing email addresses', async () => {
    const mockRepo: any = {
      getWelcomeEmailLog: async () => null,
      upsertWelcomeEmailLog: async () => ({}),
      markWelcomeEmailSent: async (_id: string, ts: string) => ({
        ...learnerProfile,
        welcome_email_sent_at: ts,
      }),
    };

    const mockFetchSent = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          requestAccepted: true,
          appsScriptExecuted: true,
          emailSendApiSucceeded: true,
          inboxDeliveryGuaranteed: false,
          senderEmail: 'campusresolveai@gmail.com',
          deliveryStatus: 'sent',
          message: 'Your welcome email has been sent successfully.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const res = await triggerWelcomeEmailIfEligible(
      learnerProfile as any,
      mockRepo,
      { bearerToken: 'mock-token', fetchFn: mockFetchSent as any }
    );

    assert.equal(res.triggered, true);
    assert.equal(res.message, 'Your welcome email has been sent successfully.');
    assert.ok(!res.message.includes('@'), 'Must never expose email addresses in user message');
    assert.ok(!res.message.includes('MailApp'), 'Must never expose Google Apps Script internal details');

    // Test duplicate send prevention
    const mockFetchAlreadySent = async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          deliveryStatus: 'already_sent',
          message: 'Welcome email was already sent for this account.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const resAlready = await triggerWelcomeEmailIfEligible(
      { ...learnerProfile, welcome_email_sent_at: '2026-11-01T00:00:00Z' } as any,
      mockRepo,
      { bearerToken: 'mock-token', fetchFn: mockFetchAlreadySent as any }
    );

    assert.equal(resAlready.triggered, false, 'Must not trigger notice when already sent');
  });
});
