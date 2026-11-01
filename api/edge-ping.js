export const config = {
  runtime: 'edge',
};

export default function handler(request) {
  return new Response(JSON.stringify({ ok: true, runtime: 'edge', timestamp: new Date().toISOString() }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
