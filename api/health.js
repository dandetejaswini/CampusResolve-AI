export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    node: process.version,
  });
}
