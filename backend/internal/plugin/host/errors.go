package host

import "fmt"

type ErrorCode string

const (
	CodeNotFound              ErrorCode = "not_found"
	CodePermissionDenied      ErrorCode = "permission_denied"
	CodeInvalidArgument       ErrorCode = "invalid_argument"
	CodeCapabilityUnavailable ErrorCode = "host_capability_unavailable"
	CodeConflict              ErrorCode = "conflict"
)

type Error struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func CapabilityUnavailable(capability string) error {
	return &Error{Code: CodeCapabilityUnavailable, Message: capability + " is not available in this host"}
}
