package main

import (
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

const provisionedVersionPath = "/var/lib/hello-remote/provisioned-version"

type configuration struct {
	Greeting           string
	User               string
	Database           string
	PasswordConfigured bool
	ProvisionedVersion string
}

func configurationFromEnv(getenv func(string) string) (configuration, error) {
	read := func(name string) (string, error) {
		raw := getenv(name)
		if raw == "" {
			return "", fmt.Errorf("%s is required", name)
		}
		decoded, err := base64.StdEncoding.DecodeString(raw)
		if err != nil {
			return "", fmt.Errorf("decode %s: %w", name, err)
		}
		if len(decoded) == 0 {
			return "", fmt.Errorf("%s is empty", name)
		}
		return string(decoded), nil
	}

	greeting, err := read("HELLO_GREETING_B64")
	if err != nil {
		return configuration{}, err
	}
	user, err := read("HELLO_USER_B64")
	if err != nil {
		return configuration{}, err
	}
	password, err := read("HELLO_PASSWORD_B64")
	if err != nil {
		return configuration{}, err
	}
	database, err := read("HELLO_DATABASE_B64")
	if err != nil {
		return configuration{}, err
	}
	return configuration{
		Greeting:           greeting,
		User:               user,
		Database:           database,
		PasswordConfigured: password != "",
	}, nil
}

func readProvisionedVersion(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read provisioned version: %w", err)
	}
	version := strings.TrimSpace(string(raw))
	if version == "" {
		return "", fmt.Errorf("read provisioned version: file is empty")
	}
	return version, nil
}
