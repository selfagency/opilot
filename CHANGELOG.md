# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.9] - 2026-03-05

## What's Changed

- fix: resolve model display and extension activation issues by @selfagency in https://github.com/selfagency/mistral-models-vscode/pull/4

**Full Changelog**: https://github.com/selfagency/mistral-models-vscode/compare/v0.1.8...v1.0.9

_Source: changes from v0.1.8 to v1.0.9._

## [0.1.8] - 2026-03-04

## What's Changed

- ui: show 'Mistral AI' in manage models detail by @selfagency in https://github.com/selfagency/mistral-models-vscode/pull/3
- ci: run tests on release tag pushes by @selfagency in https://github.com/selfagency/mistral-models-vscode/pull/2

**Full Changelog**: https://github.com/selfagency/mistral-models-vscode/compare/v0.1.7...v0.1.8

_Source: changes from v0.1.7 to v0.1.8._

## [0.1.7] - 2026-03-04

## What's Changed

- Show 'Mistral AI' in manage models dropdown by @selfagency in https://github.com/selfagency/mistral-models-vscode/pull/1

## New Contributors

- @selfagency made their first contribution in https://github.com/selfagency/mistral-models-vscode/pull/1

**Full Changelog**: https://github.com/selfagency/mistral-models-vscode/compare/v0.1.6...v0.1.7

_Source: changes from v0.1.6 to v0.1.7._

## [0.1.6] - 2026-03-01

**Full Changelog**: https://github.com/selfagency/mistral-models-vscode/compare/v0.1.5...v0.1.6

_Source: changes from v0.1.5 to v0.1.6._

## [0.1.5] - 2026-02-28

- Fixed extension bundling so dependencies are compiled into dist; removed pnpm/npm incompatibility in vsce publish
- Fixed release script: removed non-existent 'Remote Tests' workflow gate; fixed CHANGELOG insertion order
- Fixed release workflow: removed Tests-run SHA check that blocked releases when only metadata files changed

## [0.1.4] - 2026-02-28

- Forked archived project from <https://github.com/OEvortex/vscode-mistral-copilot-chat>
- Fixed failing tool calls
- Added support for all available Mistral models
- Added `@mistral` chat participant
- Added full test suite

## [0.1.3] - 2025-12-31

- Fixed API error with tool call IDs containing underscores - generate valid 9-character alphanumeric IDs when VS Code tool call IDs don't have an existing mapping

## [0.1.2] - 2025-12-23

- Added vision support for Devstral Small 2 model - can now process and analyze images
- Added tool call ID mapping system to ensure compatibility with VS Code's Language Model API
- Fixed tool call ID validation error - Mistral API returns IDs like `call_70312205` which don't meet VS Code's requirements for alphanumeric 9-character IDs. Now properly maps between Mistral and VS Code ID formats.

## [0.1.1] - Previous Release

- Integration with Mistral AI models including Devstral, Mistral Large
- GitHub Copilot Chat compatibility
- Tool calling support
- API key management
