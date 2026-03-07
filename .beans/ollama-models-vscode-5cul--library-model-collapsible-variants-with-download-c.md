---
# ollama-models-vscode-5cul
title: Library model collapsible variants with download children
status: completed
type: feature
priority: normal
created_at: 2026-03-06T16:00:08Z
updated_at: 2026-03-07T02:17:28Z
---

Library items show multiple model variants under them in a collapsible tree. Parent node shows the model name with a link button. Children show each downloadable variant (e.g., llama3.2:1b, llama3.2:3b) with a download button. Downloaded variants show a check icon. Variants are lazily fetched by scraping the model's library page HTML.

## Todo

- [x] Add `library-model-variant` and `library-model-downloaded-variant` to ModelTreeItem type union
- [x] Set library-model items to TreeItemCollapsibleState.Collapsed
- [x] Filter variant-format names from parent list
- [x] Add cachedLocalModelNames field + getCachedLocalModelNames() to LocalModelsProvider
- [x] Add variantsCache + fetchModelVariants to LibraryModelsProvider
- [x] Update getChildren to serve variant children
- [x] Update handlePullModelFromLibrary guard to accept variant types
- [x] Update package.json menus for new context values
- [x] Wire getCachedLocalModelNames in registerSidebar
- [x] Write and pass all tests
