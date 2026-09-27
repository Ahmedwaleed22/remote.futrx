package applications

import "sync"

// operationSlotSet keeps installs and uninstalls for one application and scope
// from overlapping, including preparation before an instance is persisted.
type operationSlotSet struct {
	mu       sync.Mutex
	reserved map[operationSlot]slotOperation
}

type slotOperation uint8

const (
	slotInstalling slotOperation = iota + 1
	slotUninstalling
)

type operationSlot struct {
	scope         Scope
	projectID     string
	applicationID string
}

func (s *operationSlotSet) tryReserveInstall(scope Scope, projectID, applicationID string) (func(), bool) {
	return s.tryReserve(newOperationSlot(scope, projectID, applicationID), slotInstalling)
}

func (s *operationSlotSet) tryReserveUninstall(inst Instance) (func(), bool) {
	return s.tryReserve(newOperationSlot(inst.Scope, inst.ProjectID, inst.ApplicationID), slotUninstalling)
}

func (s *operationSlotSet) isInstalling(inst Instance) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.reserved[newOperationSlot(inst.Scope, inst.ProjectID, inst.ApplicationID)] == slotInstalling
}

func (s *operationSlotSet) tryReserve(slot operationSlot, operation slotOperation) (func(), bool) {
	s.mu.Lock()
	if _, exists := s.reserved[slot]; exists {
		s.mu.Unlock()
		return nil, false
	}
	if s.reserved == nil {
		s.reserved = make(map[operationSlot]slotOperation)
	}
	s.reserved[slot] = operation
	s.mu.Unlock()
	return func() {
		s.mu.Lock()
		delete(s.reserved, slot)
		s.mu.Unlock()
	}, true
}

func newOperationSlot(scope Scope, projectID, applicationID string) operationSlot {
	if scope == ScopeGlobal {
		projectID = ""
	}
	return operationSlot{scope: scope, projectID: projectID, applicationID: applicationID}
}
