//go:build darwin

package server

import (
	"syscall"
	"unsafe"
)

// Darwin's equivalent of Linux's SO_PEERCRED is getsockopt(fd, SOL_LOCAL,
// LOCAL_PEERCRED, &xucred). The stdlib syscall package does not wrap it, so
// this calls SYS_GETSOCKOPT directly with the stable <sys/un.h> ABI:
//
//	#define SOL_LOCAL       0
//	#define LOCAL_PEERCRED  0x001
//	struct xucred { u_int version; uid_t euid; gid_t egid; u_int ngroups; gid_t groups[16]; }
//
// (uid_t/gid_t/u_int are all uint32 on Darwin.)
const (
	solLocal      = 0
	localPeerCred = 0x001
)

type xucred struct {
	Version uint32
	Euid    uint32
	Egid    uint32
	Ngroups uint32
	Groups  [16]uint32
}

// peerUID reads the connecting process's effective uid via LOCAL_PEERCRED.
//
// Validity check: errno == 0 and the kernel wrote at least 12 bytes (through
// euid+egid). Note xu_version is 0 on current macOS — do NOT treat that as
// "no credentials" (verified empirically; euid is still populated).
func peerUID(fd uintptr) (uint32, bool) {
	var cred xucred
	credLen := uint32(unsafe.Sizeof(cred))
	_, _, errno := syscall.Syscall6(
		syscall.SYS_GETSOCKOPT,
		fd,
		uintptr(solLocal),
		uintptr(localPeerCred),
		uintptr(unsafe.Pointer(&cred)),
		uintptr(unsafe.Pointer(&credLen)),
		0,
	)
	if errno != 0 || credLen < 12 {
		return 0, false
	}
	return cred.Euid, true
}
