// Runs once, on first container boot, before the healthcheck loop.
// Single-node replica set — the minimum required for transactions.
try {
  rs.status();
} catch (e) {
  rs.initiate({
    _id: 'rs0',
    members: [{ _id: 0, host: 'localhost:27017' }],
  });
}
