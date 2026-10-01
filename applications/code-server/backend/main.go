package main

import (
	appAPI "futrx.local/catalog/applications/code-server/backend/api"
	"futrx.local/catalog/applications/code-server/backend/containerio"
	"futrx.local/catalog/applications/code-server/backend/settings"

	"github.com/futrx-com/remote.futrx.com/pkg/applications/rpc"
)

func main() { rpc.Serve(appAPI.New(settings.New(containerio.ReadSettings, containerio.WriteSettings))) }
