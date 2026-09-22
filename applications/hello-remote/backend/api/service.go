package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/futrx-com/remote.futrx.com/pkg/appplugin"
)

const serviceInspectionTimeout = 5 * time.Second

type serviceInfo struct {
	Status             string `json:"status"`
	Message            string `json:"message"`
	Version            string `json:"version"`
	User               string `json:"user"`
	Database           string `json:"database"`
	PasswordConfigured bool   `json:"passwordConfigured"`
	Service            string `json:"service"`
	InternalPort       int    `json:"internalPort"`
	ExternalPort       int    `json:"externalPort"`
}

// readServiceInfo crosses the LXD proxy that Remote created from the declared
// port. It proves the manifest, guest service, host port, and backend can work
// together without teaching the plugin how Remote controls LXD.
func readServiceInfo(externalPort int) (serviceInfo, error) {
	client := http.Client{Timeout: serviceInspectionTimeout}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", externalPort))
	if err != nil {
		return serviceInfo{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return serviceInfo{}, fmt.Errorf("health endpoint returned %s", response.Status)
	}
	var info serviceInfo
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		return serviceInfo{}, fmt.Errorf("decode health response: %w", err)
	}
	return info, nil
}

func (b *backend) service(appplugin.Request) appplugin.Response {
	b.mu.Lock()
	service := b.instance.Service
	internalPort := b.instance.InternalPort
	externalPort := b.instance.ExternalPort
	inspect := b.inspectService
	b.mu.Unlock()

	if externalPort == 0 {
		return appplugin.JSON(http.StatusConflict, map[string]string{
			"error": "this install has no exposed service port",
		})
	}
	info, err := inspect(externalPort)
	if err != nil {
		return appplugin.JSON(http.StatusBadGateway, map[string]string{
			"error": fmt.Sprintf("could not reach the container service: %v", err),
		})
	}
	info.Service = service
	info.InternalPort = internalPort
	info.ExternalPort = externalPort
	return appplugin.JSON(http.StatusOK, info)
}
