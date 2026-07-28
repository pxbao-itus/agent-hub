// Package syncengine classifies and reconciles the disk-vs-manifest-vs-server
// state for a tracked skill (mirrors the retired TS CLI's diff.ts +
// sync-engine.ts).
package syncengine

// SyncAction is the sync decision table result:
//
//	disk changed? | remote changed? | action
//	--------------|------------------|-----------
//	no            | no               | up-to-date
//	no            | yes              | update
//	yes           | no               | local-only
//	yes           | yes              | conflict
//
// diskHash == nil means the file was never installed (or was deleted) —
// treated as "update" (nothing local to lose).
type SyncAction string

const (
	ActionUpToDate  SyncAction = "up-to-date"
	ActionUpdate    SyncAction = "update"
	ActionLocalOnly SyncAction = "local-only"
	ActionConflict  SyncAction = "conflict"
)

func ClassifySync(diskHash *string, lastKnownHash, remoteHash string) SyncAction {
	if diskHash == nil {
		return ActionUpdate
	}
	diskChanged := *diskHash != lastKnownHash
	remoteChanged := remoteHash != lastKnownHash
	switch {
	case !diskChanged && !remoteChanged:
		return ActionUpToDate
	case !diskChanged && remoteChanged:
		return ActionUpdate
	case diskChanged && !remoteChanged:
		return ActionLocalOnly
	default:
		return ActionConflict
	}
}
