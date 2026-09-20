package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
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
