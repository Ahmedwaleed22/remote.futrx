package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
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
