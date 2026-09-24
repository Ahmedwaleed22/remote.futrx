package api

import (
	"testing"

	"github.com/futrx-com/remote.futrx.com/pkg/applications"
)

func testBackend(t *testing.T) *backend {
	t.Helper()
	b := newBackend()
	if err := b.Init(testInstance()); err != nil {
		t.Fatal(err)
	}
	return b
}

func testInstance() applications.Instance {
	return applications.Instance{
		ApplicationID: "s3disk",
		Service:       "s3disk",
		Scope:         "project",
		ContainerName: "project-test",
		Env: map[string]string{
			"AWS_SECRET_ACCESS_KEY": "private-value",
			"S3DISK_MOUNTPOINT":     "/workspace/s3",
			"S3DISK_UPLOADS_DIR":    "uploads",
		},
	}
}
