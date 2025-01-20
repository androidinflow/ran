const PocketBase = require("pocketbase/cjs");

const pb = new PocketBase(process.env.POCKETBASE_URL);

module.exports = pb;
