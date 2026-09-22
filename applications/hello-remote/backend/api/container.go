package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
)

const containerInspectionTimeout = 5 * time.Second

type containerInfo struct {
	Name             string `json:"name"`
	Hostname         string `json:"hostname"`
	OperatingSystem  string `json:"operatingSystem"`
	Kernel           string `json:"kernel"`
	Architecture     string `json:"architecture"`
	CPUCount         int    `json:"cpuCount"`
	MemoryTotalBytes int64  `json:"memoryTotalBytes"`
	UptimeSeconds    int64  `json:"uptimeSeconds"`
}

// readContainerInfo invokes the inspector built from backend/container/ in the target
// container. The backend runs on the host and crosses only this fixed command.
func readContainerInfo(name string) (containerInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), containerInspectionTimeout)
	defer cancel()

	output, err := exec.CommandContext(
		ctx,
		"lxc", "exec", name, "--", "/usr/local/bin/hello-remote-info",
	).CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return containerInfo{}, ctx.Err()
		}
		return containerInfo{}, fmt.Errorf("lxc exec: %w: %s", err, strings.TrimSpace(string(output)))
	}

	var info containerInfo
	if err := json.Unmarshal(output, &info); err != nil {
		return containerInfo{}, fmt.Errorf("decode container response: %w", err)
	}
	return info, nil
}

func (b *backend) container(appplugin.Request) appplugin.Response {
	b.mu.Lock()
	name := b.instance.ContainerName
	inspect := b.inspectContainer
	b.mu.Unlock()

	if name == "" {
		return appplugin.JSON(http.StatusConflict, map[string]string{
			"error": "this install has no LXD container",
		})
	}
	info, err := inspect(name)
	if err != nil {
		return appplugin.JSON(http.StatusBadGateway, map[string]string{
			"error": fmt.Sprintf("could not inspect the LXD container: %v", err),
		})
	}
	info.Name = name
	return appplugin.JSON(http.StatusOK, info)
}
