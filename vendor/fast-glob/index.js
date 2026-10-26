"use strict";
// fast-glob compatible subset backed by tinyglobby (see package.json description).
const { glob, globSync } = require("tinyglobby");
const map = (o = {}) => ({ ...o, expandDirectories: false });
const sync = (patterns, options) => globSync(patterns, map(options));
const async = (patterns, options) => glob(patterns, map(options));
module.exports = Object.assign(async, { glob: async, async, globSync: sync, sync });
