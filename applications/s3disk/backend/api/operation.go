package api

import "sync"

type operation struct {
	Action  string        `json:"action"`
	Running bool          `json:"running"`
	Result  commandResult `json:"result"`
}

// operationState owns the invariant that at most one mount operation runs for
// an installed instance. Every read and transition passes through this type.
type operationState struct {
	mu      sync.Mutex
	current operation
}

func (s *operationState) snapshot() operation {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.current
}

func (s *operationState) begin(action string) (operation, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.current.Running {
		return operation{}, false
	}
	s.current = operation{Action: action, Running: true}
	return s.current, true
}

func (s *operationState) finish(action string, result commandResult) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.current = operation{Action: action, Result: result}
}
