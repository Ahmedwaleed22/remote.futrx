package applications

import "sync"

// installSlotSet reserves one application within a scope while its install is
// in flight, including the preparation before an instance is first persisted.
type installSlotSet struct {
	mu       sync.Mutex
	reserved map[installSlot]struct{}
}

type installSlot struct {
	scope         Scope
	projectID     string
	applicationID string
}

func (s *installSlotSet) tryReserve(scope Scope, projectID, applicationID string) (func(), bool) {
	if scope == ScopeGlobal {
		projectID = ""
	}
	slot := installSlot{scope: scope, projectID: projectID, applicationID: applicationID}
	s.mu.Lock()
	if _, exists := s.reserved[slot]; exists {
		s.mu.Unlock()
		return nil, false
	}
	if s.reserved == nil {
		s.reserved = make(map[installSlot]struct{})
	}
	s.reserved[slot] = struct{}{}
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.reserved, slot)
		s.mu.Unlock()
	}, true
}
