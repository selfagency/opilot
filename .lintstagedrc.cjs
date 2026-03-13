module.exports = {
  'scripts/*.mjs': ['task precommit -- '],
  'src/**/*.ts': ['task precommit -- '],
  '**/*.{json,yml,yaml,md}': files => {
    const targets = files.filter(f => !f.endsWith('pnpm-lock.yaml'));
    return targets.length ? [`oxfmt --write -- ${targets.join(' ')}`] : [];
  },
};
