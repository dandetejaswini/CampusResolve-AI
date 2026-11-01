/**
 * ============================================================================
 * CAMPUSRESOLVE AI — GOOGLE APPS SCRIPT WELCOME EMAIL AUTOMATION
 * ============================================================================
 * Dedicated Google Account: campusresolveai@gmail.com
 *
 * Purpose:
 * Receives authenticated server-to-server POST requests from the CampusResolve AI
 * backend (/api/auth/welcome-email) and dispatches a one-time HTML welcome email
 * via Gmail (MailApp / GmailApp) using the approved Warm-Neutral palette:
 *   - Charcoal:    #292A25
 *   - Muted Olive: #777B63
 *   - Warm Taupe:  #B5A58D
 *   - Linen:       #E8E4DC
 *   - Ivory:       #F8F7F3
 *
 * Required Script Properties (Project Settings -> Script Properties):
 *   - APPS_SCRIPT_SHARED_SECRET : High-entropy secret matching Vercel env var
 *   - EXPECTED_SENDER_EMAIL     : campusresolveai@gmail.com
 *   - APPLICATION_BASE_URL      : Production or preview base URL of CampusResolve AI
 * ============================================================================
 */

var DEDICATED_SENDER_EMAIL = 'campusresolveai@gmail.com';
var SENDER_DISPLAY_NAME = 'CampusResolve AI';

/**
 * Handles incoming POST requests from the CampusResolve AI backend.
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Acquire concurrency lock for up to 10 seconds to prevent race conditions
    lock.waitLock(10000);

    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse(400, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'EMPTY_PAYLOAD',
        message: 'Request body is required.'
      });
    }

    var payload;
    try {
      payload = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonResponse(400, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'INVALID_JSON',
        message: 'Malformed JSON request body.'
      });
    }

    var scriptProps = PropertiesService.getScriptProperties();
    var configuredSecret = scriptProps.getProperty('APPS_SCRIPT_SHARED_SECRET');

    if (!configuredSecret || configuredSecret.length < 16) {
      return jsonResponse(503, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'SCRIPT_SECRET_NOT_CONFIGURED',
        message: 'APPS_SCRIPT_SHARED_SECRET is not configured in Google Apps Script Properties.'
      });
    }

    // Constant-time secret verification
    var providedSecret = String(payload.sharedSecret || '');
    if (!constantTimeEquals(providedSecret, configuredSecret)) {
      return jsonResponse(401, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'UNAUTHORIZED_SECRET',
        message: 'Invalid shared secret.'
      });
    }

    // Validate required payload fields
    var profileId = String(payload.profileId || '').trim();
    var recipientEmail = String(payload.recipientEmail || '').trim().toLowerCase();
    var displayName = String(payload.displayName || 'Institutional Member').trim();
    var authProvider = String(payload.authProvider || '').trim();
    var actorRole = String(payload.actorRole || 'learner').trim();

    var configuredBaseUrl = String(
      scriptProps.getProperty('APPLICATION_BASE_URL') || payload.applicationBaseUrl || ''
    ).trim().replace(/\/+$/, '');
    var signInUrl = String(payload.signInUrl || (configuredBaseUrl ? configuredBaseUrl + '/sign-in' : '')).trim();

    if (!profileId || !recipientEmail || !isValidEmailAddress(recipientEmail)) {
      return jsonResponse(400, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'INVALID_PARAMETERS',
        message: 'Valid profileId and recipientEmail are required.'
      });
    }

    if (authProvider !== 'supabase_email' && authProvider !== 'firebase_google') {
      return jsonResponse(400, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'INVALID_AUTH_PROVIDER',
        message: 'authProvider must be supabase_email or firebase_google.'
      });
    }

    if (!signInUrl || signInUrl.indexOf('http') !== 0) {
      return jsonResponse(400, {
        ok: false,
        requestAccepted: false,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'INVALID_SIGN_IN_URL',
        message: 'A valid application signInUrl is required.'
      });
    }

    // Script-level idempotency check (prevents duplicate sends on webhook retries)
    var idempotencyPropertyKey = 'WELCOME_SENT_' + profileId;
    var existingSentTimestamp = scriptProps.getProperty(idempotencyPropertyKey);
    if (existingSentTimestamp) {
      return jsonResponse(200, {
        ok: true,
        requestAccepted: true,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        alreadySent: true,
        inboxDeliveryGuaranteed: false,
        senderEmail: DEDICATED_SENDER_EMAIL,
        sentAt: existingSentTimestamp,
        code: 'ALREADY_SENT_IDEMPOTENT',
        message: 'Welcome email was already dispatched for profileId ' + profileId + ' at ' + existingSentTimestamp + '.'
      });
    }

    // Verify executing Google account & remaining daily quota
    var effectiveUserEmail = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    var remainingQuota = MailApp.getRemainingDailyQuota();
    if (remainingQuota <= 0) {
      return jsonResponse(429, {
        ok: false,
        requestAccepted: true,
        appsScriptExecuted: true,
        emailSendApiSucceeded: false,
        inboxDeliveryGuaranteed: false,
        code: 'GMAIL_QUOTA_EXHAUSTED',
        message: 'Google Apps Script daily MailApp quota is exhausted (0 remaining).'
      });
    }

    var subject = 'Welcome to CampusResolve AI — Your Workspace Account Is Active';
    var htmlBody = buildWelcomeEmailHtml({
      displayName: displayName,
      recipientEmail: recipientEmail,
      authProvider: authProvider,
      actorRole: actorRole,
      signInUrl: signInUrl,
      senderEmail: DEDICATED_SENDER_EMAIL
    });
    var plainTextBody = buildWelcomeEmailPlainText({
      displayName: displayName,
      recipientEmail: recipientEmail,
      authProvider: authProvider,
      actorRole: actorRole,
      signInUrl: signInUrl,
      senderEmail: DEDICATED_SENDER_EMAIL
    });

    MailApp.sendEmail({
      to: recipientEmail,
      subject: subject,
      body: plainTextBody,
      htmlBody: htmlBody,
      name: SENDER_DISPLAY_NAME,
      replyTo: DEDICATED_SENDER_EMAIL
    });

    var sentAtIso = new Date().toISOString();
    scriptProps.setProperty(idempotencyPropertyKey, sentAtIso);

    return jsonResponse(200, {
      ok: true,
      requestAccepted: true,
      appsScriptExecuted: true,
      emailSendApiSucceeded: true,
      inboxDeliveryGuaranteed: false,
      senderEmail: effectiveUserEmail || DEDICATED_SENDER_EMAIL,
      remainingDailyQuota: remainingQuota - 1,
      sentAt: sentAtIso,
      code: 'EMAIL_SEND_API_SUCCEEDED',
      message: 'MailApp.sendEmail succeeded from ' + (effectiveUserEmail || DEDICATED_SENDER_EMAIL) + ' to ' + recipientEmail + '.'
    });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      requestAccepted: true,
      appsScriptExecuted: true,
      emailSendApiSucceeded: false,
      inboxDeliveryGuaranteed: false,
      code: 'APPS_SCRIPT_EXECUTION_ERROR',
      message: err && err.message ? String(err.message) : 'Unexpected error in Google Apps Script.'
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_ignore) {}
  }
}

/**
 * Builds the responsive Warm-Neutral HTML email body.
 * Palette:
 *   Charcoal:    #292A25
 *   Muted Olive: #777B63
 *   Warm Taupe:  #B5A58D
 *   Linen:       #E8E4DC
 *   Ivory:       #F8F7F3
 */
function buildWelcomeEmailHtml(data) {
  var safeName = escapeHtml(data.displayName);
  var safeEmail = escapeHtml(data.recipientEmail);
  var safeSignInUrl = escapeHtml(data.signInUrl);
  var safeSender = escapeHtml(data.senderEmail);
  var providerLabel =
    data.authProvider === 'firebase_google'
      ? 'Google Authentication (Firebase)'
      : 'Email & Password Authentication (Supabase)';
  var roleLabel = escapeHtml(
    data.actorRole === 'learner' ? 'Learner (Default Least-Privilege Scope)' : data.actorRole
  );

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '<title>Welcome to CampusResolve AI</title>',
    '</head>',
    '<body style="margin:0;padding:0;background-color:#E8E4DC;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#292A25;">',
    '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#E8E4DC;padding:32px 16px;">',
    '    <tr>',
    '      <td align="center">',
    '        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background-color:#F8F7F3;border:1px solid #B5A58D;border-radius:6px;overflow:hidden;">',
    '          <!-- Header Bar -->',
    '          <tr>',
    '            <td style="background-color:#292A25;padding:24px 32px;border-bottom:3px solid #777B63;">',
    '              <p style="margin:0 0 4px 0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#B5A58D;font-weight:600;">',
    '                Academic Request Routing &amp; Policy Governance',
    '              </p>',
    '              <h1 style="margin:0;font-family:Georgia,\'Times New Roman\',serif;font-size:24px;font-weight:normal;color:#F8F7F3;letter-spacing:-0.01em;">',
    '                CampusResolve AI',
    '              </h1>',
    '            </td>',
    '          </tr>',
    '          <!-- Main Content -->',
    '          <tr>',
    '            <td style="padding:32px;">',
    '              <h2 style="margin:0 0 16px 0;font-family:Georgia,\'Times New Roman\',serif;font-size:22px;font-weight:normal;color:#292A25;">',
    '                Welcome, ' + safeName,
    '              </h2>',
    '              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:#292A25;">',
    '                Your CampusResolve AI account has been verified and activated. You can now access the workspace to submit inquiries, review policy-grounded guidance, and track academic or administrative request resolution.',
    '              </p>',
    '              <p style="margin:0 0 24px 0;font-size:14px;line-height:1.65;color:#292A25;">',
    '                <strong>About the Platform:</strong> CampusResolve AI is an intelligent platform for routing learner and instructor requests, retrieving policy-grounded answers from published institutional references, and tracking resolution and escalation across departments.',
    '              </p>',
    '              <!-- Account Summary Box -->',
    '              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#E8E4DC;border:1px solid #B5A58D;border-radius:4px;margin-bottom:28px;">',
    '                <tr>',
    '                  <td style="padding:16px 20px;">',
    '                    <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#777B63;">',
    '                      Activated Account Details',
    '                    </p>',
    '                    <p style="margin:0 0 6px 0;font-size:13px;color:#292A25;">',
    '                      <strong>Verified Email:</strong> ' + safeEmail,
    '                    </p>',
    '                    <p style="margin:0 0 6px 0;font-size:13px;color:#292A25;">',
    '                      <strong>Sign-In Method:</strong> ' + providerLabel,
    '                    </p>',
    '                    <p style="margin:0;font-size:13px;color:#292A25;">',
    '                      <strong>Assigned Workspace Role:</strong> ' + roleLabel,
    '                    </p>',
    '                  </td>',
    '                </tr>',
    '              </table>',
    '              <!-- CTA Button -->',
    '              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-bottom:28px;">',
    '                <tr>',
    '                  <td align="center" style="border-radius:4px;background-color:#292A25;">',
    '                    <a href="' + safeSignInUrl + '" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#F8F7F3;text-decoration:none;border-radius:4px;">',
    '                      Sign In to CampusResolve AI &rarr;',
    '                    </a>',
    '                  </td>',
    '                </tr>',
    '              </table>',
    '              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;color:#777B63;">',
    '                Or copy and paste this Sign In link into your browser:<br />',
    '                <a href="' + safeSignInUrl + '" style="color:#777B63;word-break:break-all;">' + safeSignInUrl + '</a>',
    '              </p>',
    '              <hr style="border:none;border-top:1px solid #E8E4DC;margin:24px 0;" />',
    '              <p style="margin:0;font-size:13px;line-height:1.6;color:#292A25;">',
    '                Warm regards,<br />',
    '                <strong>CampusResolve AI Notification Service</strong><br />',
    '                <span style="font-size:12px;color:#777B63;">' + safeSender + '</span>',
    '              </p>',
    '            </td>',
    '          </tr>',
    '        </table>',
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>'
  ].join('\n');
}

function buildWelcomeEmailPlainText(data) {
  var providerLabel =
    data.authProvider === 'firebase_google'
      ? 'Google Authentication (Firebase)'
      : 'Email & Password Authentication (Supabase)';

  return [
    'CAMPUSRESOLVE AI',
    'Academic Request Routing & Policy Governance',
    '------------------------------------------------------------',
    '',
    'Welcome, ' + data.displayName + ',',
    '',
    'Your CampusResolve AI account has been verified and activated.',
    '',
    'About CampusResolve AI:',
    'CampusResolve AI is an intelligent platform for routing learner and instructor requests, retrieving policy-grounded answers, and tracking resolution and escalation.',
    '',
    'Activated Account Details:',
    '- Verified Email: ' + data.recipientEmail,
    '- Sign-In Method: ' + providerLabel,
    '- Assigned Workspace Role: ' + data.actorRole,
    '',
    'Sign In to your workspace:',
    data.signInUrl,
    '',
    'Warm regards,',
    'CampusResolve AI Notification Service',
    data.senderEmail
  ].join('\n');
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function constantTimeEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  if (a.length !== b.length) {
    return false;
  }
  var mismatch = 0;
  for (var i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonResponse(statusCode, obj) {
  var payload = Object.assign({ httpStatus: statusCode }, obj);
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}
