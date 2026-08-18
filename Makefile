SHELL := /bin/bash
.DEFAULT_GOAL := help

DAEMON_DIR  := daemon
DAEMON_BIN  := daemon/bin/waiting-room
VERSION     ?= 0.1.0

.PHONY: help
help: ## Show available targets
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: build
build: build-daemon build-ts ## Build the Go daemon binary and all TS packages

.PHONY: build-daemon
build-daemon: ## Build the waiting-room Go binary (static, CGO disabled)
	cd $(DAEMON_DIR) && CGO_ENABLED=0 go build -trimpath -ldflags "-X main.Version=$(VERSION)" -o ../$(DAEMON_BIN) ./cmd/waiting-room

.PHONY: build-ts
build-ts: ## Build (tsc) all TS workspace packages
	pnpm -r run build

.PHONY: test
test: test-daemon test-ts ## Run Go + TS tests

.PHONY: test-daemon
test-daemon: ## Run Go unit tests
	cd $(DAEMON_DIR) && go test ./...

.PHONY: test-ts
test-ts: ## Run TS tests
	pnpm -r run test

.PHONY: lint
lint: ## Vet Go + lint TS
	cd $(DAEMON_DIR) && go vet ./...
	pnpm -r run lint

.PHONY: fmt
fmt: ## Format Go (gofmt) + TS
	cd $(DAEMON_DIR) && gofmt -s -w .
	-pnpm -r run fmt

.PHONY: integration
integration: ## Run real-tmux integration tests (requires tmux)
	cd $(DAEMON_DIR) && go test -tags=integration ./...

.PHONY: clean
clean: ## Remove build artifacts
	rm -f $(DAEMON_BIN)
	rm -rf packages/*/dist
	-pnpm -r run clean

PLATFORMS := darwin-arm64 darwin-amd64 linux-arm64 linux-amd64

.PHONY: cli-pack
cli-pack: ## Cross-compile binaries into the @waiting-room/cli-* platform packages
	@mkdir -p packages/plugin-claude/bin
	@for p in $(PLATFORMS); do \
		os=$${p%-*}; arch=$${p##*-}; \
		echo "  building $$p"; \
		(cd daemon && CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath \
			-ldflags "-X main.Version=$(VERSION)" \
			-o ../packages/cli-$$p/bin/waiting-room ./cmd/waiting-room) || exit 1; \
	done
	@echo "packed: $(PLATFORMS)"

.PHONY: plugin-pack
plugin-pack: cli-pack ## Vendor platform binaries into plugin-claude (self-contained plugin)
	@for p in $(PLATFORMS); do \
		cp packages/cli-$$p/bin/waiting-room packages/plugin-claude/bin/waiting-room-$$p || exit 1; \
	done
	@echo "plugin-claude is self-contained: packages/plugin-claude/bin/waiting-room-*"
