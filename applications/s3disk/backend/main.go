// S3Disk's host composition root. Remote builds this process from backend/.
package main

import (
	appAPI "futrx.local/catalog/applications/s3disk/backend/api"
	"github.com/futrx-com/remote.futrx.com/pkg/applications/rpc"
)

func main() { rpc.Serve(appAPI.New()) }
