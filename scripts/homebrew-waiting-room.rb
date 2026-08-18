# Homebrew formula template for waiting-room.
# At release time: fill in the tag/version and `sha256` checksums (from the
# release's checksums.txt), then publish to a tap (e.g. alifarooqi/homebrew-tap):
#   brew tap alifarooqi/tap && brew install waiting-room
class WaitingRoom < Formula
  desc "Pause side activities and snap focus back when Claude Code needs you"
  homepage "https://github.com/alifarooqi/claude-waiting-room"
  url "https://github.com/alifarooqi/claude-waiting-room/archive/refs/tags/v0.1.0.tar.gz"
  # sha256 "FILL_ME_FROM_RELEASE_CHECKSUMS"
  license "MIT"

  def install
    system "go", "build", "-trimpath", "-ldflags", "-s -w -X main.Version=#{version}",
           "-o", "waiting-room", "./cmd/waiting-room", chdir: "daemon"
    bin.install "waiting-room"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/waiting-room version")
  end
end
