package main

import (
	"reflect"
	"testing"
)

func TestSplitEmitArgs(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want string
		flags []string
	}{
		{
			name:  "positional first, flags after",
			in:    []string{"agent_working", "--reason", "stop"},
			want:  "agent_working",
			flags: []string{"--reason", "stop"},
		},
		{
			name:  "flags before positional",
			in:    []string{"--session", "x", "agent_needs_attention", "--strict"},
			want:  "agent_needs_attention",
			flags: []string{"--session", "x", "--strict"},
		},
		{
			name:  "equals-form flag",
			in:    []string{"--session=x", "agent_working"},
			want:  "agent_working",
			flags: []string{"--session=x"},
		},
		{
			name:  "positional only",
			in:    []string{"agent_heartbeat"},
			want:  "agent_heartbeat",
			flags: nil,
		},
		{
			name:  "nothing",
			in:    nil,
			want:  "",
			flags: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, flags := splitEmitArgs(c.in)
			if got != c.want {
				t.Fatalf("event = %q, want %q", got, c.want)
			}
			if len(flags) == 0 && len(c.flags) == 0 {
				return
			}
			if !reflect.DeepEqual(flags, c.flags) {
				t.Fatalf("flags = %v, want %v", flags, c.flags)
			}
		})
	}
}
