#!/bin/sh
# Bump the version that the install-on-first-hook resolver fetches from
# GitHub Releases (WAITING_ROOM_VERSION in the resolver) AND the matching
# Claude plugin manifest version, in lock-step. The new version MUST
# already exist as a goreleaser-tagged GitHub release before pointing
# users at it. See docs/releasing.md for the full release flow.
#
# Usage:  scripts/bump-waiting-room-version.sh v1.0.3
#      or
#         scripts/bump-waiting-room-version.sh 1.0.3   (the leading v is optional)

set -eu

NEW_VERSION=${1:-}
if [ -z "$NEW_VERSION" ]; then
    echo "usage: $0 <version>  (e.g. v1.0.3 or 1.0.3)" >&2
    exit 1
fi

# Canonicalize: strip a leading v if present, reattach.
NEW_VERSION=$(printf '%s' "$NEW_VERSION" | sed -E 's/^v?(.+)$/v\1/')

RESOLVER=packages/plugin-claude/bin/waiting-room
MANIFEST=packages/plugin-claude/.claude-plugin/plugin.json

# Use perl (not sed) for both edits. Perl's `\x{22}` makes it easy to embed
# literal double quotes without fighting shell-escaping rules. Capture the
# entire "1.0.0" (or current value) and replace it whole.
NEW=${NEW_VERSION#v}  # strip leading v for the manifest

perl -i -pe "s|^(WAITING_ROOM_VERSION=)\"[^\"]+\"|\$1\"$NEW_VERSION\"|" "$RESOLVER"

perl -i -pe "s|^(  \"version\": )\"[^\"]+\"|\$1\"$NEW\"|" "$MANIFEST"

chmod +x "$RESOLVER"

echo "Bumped to $NEW_VERSION:"
echo "  $RESOLVER"
grep "WAITING_ROOM_VERSION" "$RESOLVER" | head -1
echo "  $MANIFEST"
grep '"version"' "$MANIFEST" | head -1