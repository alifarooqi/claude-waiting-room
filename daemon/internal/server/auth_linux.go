//go:build linux

package server

import "syscall"

// peerUID reads the connecting process's uid via SO_PEERCRED (stdlib syscall).
func peerUID(fd uintptr) (uint32, bool) {
	cred, err := syscall.GetsockoptUcred(int(fd), syscall.SOL_SOCKET, syscall.SO_PEERCRED)
	if err != nil || cred == nil {
		return 0, false
	}
	return cred.Uid, true
}
