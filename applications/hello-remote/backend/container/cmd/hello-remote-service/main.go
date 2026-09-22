package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"
)

var version = "development"

type configuration struct {
	Greeting           string
	User               string
	Database           string
	PasswordConfigured bool
}

type healthResponse struct {
	Status             string `json:"status"`
	Message            string `json:"message"`
	Version            string `json:"version"`
	User               string `json:"user"`
	Database           string `json:"database"`
	PasswordConfigured bool   `json:"passwordConfigured"`
}

func main() {
	if err := run(os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string, getenv func(string) string, stdout io.Writer) error {
	if len(args) == 1 && args[0] == "--version" {
		fmt.Fprintln(stdout, version)
		return nil
	}
	if len(args) == 0 {
		return errors.New("usage: hello-remote-service serve|health [options]")
	}

	switch args[0] {
	case "serve":
		flags := flag.NewFlagSet("serve", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		port := flags.Int("port", 0, "TCP port to listen on")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if err := validPort(*port); err != nil {
			return err
		}
		config, err := configurationFromEnv(getenv)
		if err != nil {
			return err
		}
		server := &http.Server{
			Addr:              "0.0.0.0:" + strconv.Itoa(*port),
			Handler:           serviceHandler(config),
			ReadHeaderTimeout: 5 * time.Second,
		}
		return server.ListenAndServe()
	case "health":
		flags := flag.NewFlagSet("health", flag.ContinueOnError)
		flags.SetOutput(io.Discard)
		port := flags.Int("port", 0, "TCP port to probe")
		if err := flags.Parse(args[1:]); err != nil {
			return err
		}
		if err := validPort(*port); err != nil {
			return err
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		return probe(ctx, fmt.Sprintf("http://127.0.0.1:%d/health", *port))
	default:
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func validPort(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	return nil
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

func serviceHandler(config configuration) http.Handler {
	mux := http.NewServeMux()
	handle := func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet {
			writer.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(healthResponse{
			Status:             "ok",
			Message:            config.Greeting + " from the container service.",
			Version:            version,
			User:               config.User,
			Database:           config.Database,
			PasswordConfigured: config.PasswordConfigured,
		})
	}
	mux.HandleFunc("/", handle)
	mux.HandleFunc("/health", handle)
	return mux
}

func probe(ctx context.Context, url string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("health endpoint returned %s", response.Status)
	}
	return nil
}
