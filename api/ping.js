export default async function handler(req, res) {
  try {
    const payload = JSON.stringify({
      ok: true,
      hasReq: Boolean(req),
      hasRes: Boolean(res),
      nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown',
    });

    if (res && typeof res.setHeader === 'function') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(payload);
      return;
    }

    if (res && typeof res.status === 'function') {
      res.status(200).json(JSON.parse(payload));
      return;
    }

    return new Response(payload, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
