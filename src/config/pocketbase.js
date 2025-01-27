const PocketBase = require("pocketbase/cjs");

const pb = new PocketBase(process.env.POCKETBASE_URL);

// Disable auto-cancellation globally
pb.autoCancellation(false);

module.exports = pb;
