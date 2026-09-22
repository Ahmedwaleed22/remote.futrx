package applications

import (
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"path"
	"strings"

	svc "github.com/futrx-com/remote.futrx.com/internal/service/applications"
)

// backendDir is the fixed directory an application ships its Go backend in. Like
// ui/, the directory is the opt-in: application.json's backend block only overrides
// defaults, so a application cannot be declared without shipping one.
const backendDir = "backend"

// An application's backend/ holds Go for two different machines, and the
// directory names are the only thing that says which is which.
//
// backendAPIDir is compiled here, by this server, and run as a child process on
// the host. backendContainerDir is never compiled here: it is packed and built
// inside the target LXD container, for that container's own architecture, and
// reached over lxc exec.
const (
	backendAPIDir       = "api"
	backendContainerDir = "container"
)

// resolveBackendSource resolves which directory under backend/ the host
// compiles and reports whether the application carries host source at all.
//
// backend/api/ is the current layout. Go at backend/'s own root is the original
// flat layout, still resolved so that packages uploaded before the split keep
// building across a server update — uploaded packages outlive the binary that
// installed them, so dropping the fallback would break them in place.
//
// backend/container/ is an independent capability and does not, by itself,
// opt the application into a host RPC process.
func resolveBackendSource(fsys fs.FS, root string) (string, bool) {
	api := path.Join(root, backendAPIDir)
	if info, err := fs.Stat(fsys, api); err == nil && info.IsDir() {
		return api, true
	}
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.Name() != backendContainerDir {
			return root, true
		}
	}
	return "", false
}

// loadApplicationBackend resolves an application's backend/ directory into a validated
// descriptor. It checks the shape the build depends on — that there is Go
// source, that it is a program rather than a library, and that it does not
// carry its own module — because every one of those failures would otherwise
// surface as a compiler error on a production server at install time.
func loadApplicationBackend(fsys fs.FS, root string, declared *svc.ApplicationBackend) (*svc.ApplicationBackend, error) {
	if _, err := fs.Stat(fsys, root); err != nil {
		if declared != nil {
			return nil, fmt.Errorf("application.json declares backend but %s does not exist", root)
		}
		return nil, nil
	}
	source, ok := resolveBackendSource(fsys, root)
	if !ok {
		if declared != nil {
			return nil, fmt.Errorf("application.json declares backend but %s has no host source", root)
		}
		return nil, nil
	}

	backend := svc.ApplicationBackend{}
	if declared != nil {
		backend = *declared
	}
	if backend.Access != "" && !backend.Access.Valid() {
		return nil, fmt.Errorf("invalid access %q", backend.Access)
	}
	if backend.TimeoutMS < 0 {
		return nil, fmt.Errorf("timeoutMs must not be negative")
	}
	if err := validateBackendLayout(fsys, root, source); err != nil {
		return nil, err
	}
	return &backend, nil
}

// validateBackendLayout checks backend/ as a whole, then the one directory the
// host actually compiles.
func validateBackendLayout(fsys fs.FS, root, source string) error {
	if source != root {
		if err := rejectStrayBackendRoot(fsys, root); err != nil {
			return err
		}
	}
	return validateBackendSource(fsys, source)
}

// rejectStrayBackendRoot enforces that backend/'s own root carries no build
// inputs once backend/api/ exists. Go source left there is never compiled and
// never runs, which reads as live code to everyone who opens it; a module file
// there is never used at all. Both are silent mistakes, so both are errors.
func rejectStrayBackendRoot(fsys fs.FS, root string) error {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return fmt.Errorf("read %s: %w", root, err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == "go.mod" || name == "go.sum" {
			return fmt.Errorf(
				"%s/%s is not supported: the server generates the backend module", root, name)
		}
		if strings.HasSuffix(name, ".go") {
			return fmt.Errorf(
				"%s/%s is ignored when %s exists: move host source into %s",
				root, name, path.Join(root, backendAPIDir), path.Join(root, backendAPIDir))
		}
	}
	return nil
}

// validateBackendSource enforces what the build directory the server generates
// can actually compile: package main at the root of the compiled directory, and
// no module file of its own, since the server writes one that pins the SDK.
func validateBackendSource(fsys fs.FS, root string) error {
	entries, err := fs.ReadDir(fsys, root)
	if err != nil {
		return fmt.Errorf("read %s: %w", root, err)
	}
	mainFiles := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() {
			continue
		}
		if name == "go.mod" || name == "go.sum" {
			return fmt.Errorf(
				"%s/%s is not supported: the server generates the backend module", root, name)
		}
		if !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		pkg, err := packageName(fsys, path.Join(root, name))
		if err != nil {
			return err
		}
		if pkg != "main" {
			return fmt.Errorf("%s/%s declares package %q, want main", root, name, pkg)
		}
		mainFiles++
	}
	if mainFiles == 0 {
		return fmt.Errorf("%s contains no package main source", root)
	}
	return nil
}

func packageName(fsys fs.FS, name string) (string, error) {
	source, err := fs.ReadFile(fsys, name)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", name, err)
	}
	file, err := parser.ParseFile(token.NewFileSet(), name, source, parser.PackageClauseOnly)
	if err != nil {
		return "", fmt.Errorf("parse %s: %w", name, err)
	}
	return file.Name.Name, nil
}

// BackendSource returns the Go source the application backend host compiles, rooted at the
// directory that holds it — backend/api/ in the current layout, backend/ itself
// in the flat one. Unlike ui/ assets these bytes are never served, so there is
// no path-traversal surface here: a caller gets the whole subtree or nothing.
//
// backend/container/ is deliberately outside whatever this returns. That source
// is built inside the target container, so handing it to the host compiler
// would be wrong, and including it would make the build fingerprint change
// whenever container-only code changed.
func (r *Registry) BackendSource(applicationID string) (fs.FS, bool) {
	img, catalog, ok := r.applicationSource(applicationID)
	if !ok || img.Backend == nil {
		return nil, false
	}
	root := path.Join(catalogRoot, applicationID, backendDir)
	source, ok := resolveBackendSource(catalog, root)
	if !ok {
		return nil, false
	}
	sub, err := fs.Sub(catalog, source)
	if err != nil {
		return nil, false
	}
	return sub, true
}
