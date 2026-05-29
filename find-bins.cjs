'use strict';
const path = require('node:path');
const base = __dirname;
const bins = {
  ultracite: require(path.join(base, 'node_modules/ultracite/package.json')).bin,
  typescript: require(path.join(base, 'node_modules/typescript/package.json')).bin,
  tsup: require(path.join(base, 'node_modules/tsup/package.json')).bin,
  vitest: require(path.join(base, 'node_modules/vitest/package.json')).bin,
  zx: require(path.join(base, 'node_modules/zx/package.json')).bin
};
for (const [pkg, bin] of Object.entries(bins)) {
  if (typeof bin === 'object') {
    for (const [name, rel] of Object.entries(bin)) {
      console.log(`${pkg}/${name} -> ${rel}`);
    }
  } else {
    console.log(`${pkg} -> ${bin}`);
  }
}
