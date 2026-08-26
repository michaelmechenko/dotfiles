package nav

// KeyAction is one discoverable keyboard action. Global actions live in the
// model; sources optionally provide their own actions through KeyActions so
// help never needs a source-name branch.
type KeyAction struct {
	Key     string
	Summary string
}

// ActionProvider is the optional help half of Source. Implement it whenever a
// SourceController accepts local keys: the model combines these descriptors with
// its registered global actions for both the compact overlay and diagnostics.
type ActionProvider interface {
	KeyActions() []KeyAction
}
