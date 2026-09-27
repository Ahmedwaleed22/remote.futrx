package applications

import "sync"

// installSlotSet reserves one application within a scope while an install or
// uninstall is in flight, including preparation before an instance is persisted.
type installSlotSet struct {
	mu       sync.Mutex
	reserved map[installSlot]slotOperation
}

type slotOperation uint8

const (
	slotInstalling slotOperation = iota + 1
	slotUninstalling
)

type installSlot struct {
	scope         Scope
	projectID     string
	applicationID string
}

func (s *installSlotSet) tryReserve(scope Scope, projectID, applicationID string, operation slotOperation) (func(), bool) {
	slot := newInstallSlot(scope, projectID, applicationID)
	s.mu.Lock()
	if _, exists := s.reserved[slot]; exists {
		s.mu.Unlock()
		return nil, false
	}
	if s.reserved == nil {
		s.reserved = make(map[installSlot]slotOperation)
	}
	s.reserved[slot] = operation
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.reserved, slot)
		s.mu.Unlock()
	}, true
}

func (s *installSlotSet) isInstalling(scope Scope, projectID, applicationID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reserved[newInstallSlot(scope, projectID, applicationID)] == slotInstalling
}

func newInstallSlot(scope Scope, projectID, applicationID string) installSlot {
	if scope == ScopeGlobal {
		projectID = ""
	}
	return installSlot{scope: scope, projectID: projectID, applicationID: applicationID}
}
